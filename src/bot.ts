import { Telegraf, type Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runAgentLoop } from './agent/loop';
import { generateMorningBrief, writeEveningLog } from './crons';
import { runDayPlan } from './agent/dayplan';
import { lastMessageWasEveningCheckIn } from './state';
import { logMessage } from './db';
import { transcribeVoice } from './integrations/groq';
import { formatForTelegram, escapeHtml } from './utils/formatter';
import { isCreditsError } from './utils/errors';
import { runCapturePipeline, resolvePending } from './capture/pipeline';
import type { Classification } from './capture/classify';

const ALLOWED_CHAT_ID = process.env.TELEGRAM_CHAT_ID!;

type ConvoMessage = { role: string; content: string };

interface PendingCapture {
  classification: Classification;
  originalMessage: string;
}

const pending = new Map<string, PendingCapture>();
const lastMessageWasBrief = new Map<string, boolean>();
const conversationHistories = new Map<string, ConvoMessage[]>();

const CAPTURE_KEYWORDS = ['capture ', 'note ', 'save ', 'insight ', 'learned ', 'log — '];

function isExplicitCapture(msg: string): boolean {
  const lower = msg.trim().toLowerCase();
  return CAPTURE_KEYWORDS.some(kw => lower.startsWith(kw));
}

export function createBot(): Telegraf {
  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

  bot.command('updatecontext', async (ctx) => {
    if (String(ctx.chat.id) !== ALLOWED_CHAT_ID) return;
    try {
      const content = readFileSync(join(process.cwd(), 'context-updates.md'), 'utf-8').trim();
      if (!content) {
        await ctx.reply('context-updates.md is empty.');
      } else {
        await ctx.reply(`<pre>${escapeHtml(content)}</pre>`, { parse_mode: 'HTML' });
      }
    } catch {
      await ctx.reply('context-updates.md not found.');
    }
  });

  bot.on(message('text'), async (ctx) => {
    const chatId = String(ctx.chat.id);
    if (chatId !== ALLOWED_CHAT_ID) return;
    const text = ctx.message.text;
    if (text.startsWith('/')) return;
    await handleIncoming(ctx, chatId, text, 'text');
  });

  bot.on(message('voice'), async (ctx) => {
    const chatId = String(ctx.chat.id);
    if (chatId !== ALLOWED_CHAT_ID) return;
    try {
      await ctx.sendChatAction('typing');
      const transcript = await transcribeVoice(ctx.message.voice.file_id);
      console.log(`[${ts()}] voice → "${transcript}"`);
      await handleIncoming(ctx, chatId, transcript, 'voice', `heard: ${escapeHtml(transcript)}\n\n`);
    } catch (err) {
      console.error('transcription error:', err);
      await ctx.reply('could not transcribe. please try again.');
    }
  });

  return bot;
}

async function handleIncoming(
  ctx: Context,
  chatId: string,
  userMessage: string,
  contentType: 'text' | 'voice',
  replyPrefix = ''
) {
  console.log(`[${ts()}] ${contentType}: ${userMessage}`);

  try {
    await ctx.sendChatAction('typing');
    await logMessage(chatId, 'user', userMessage);

    // Initialise history for this chat if needed
    if (!conversationHistories.has(chatId)) conversationHistories.set(chatId, []);
    const history = conversationHistories.get(chatId)!;

    const wasBrief = lastMessageWasBrief.get(chatId) ?? false;
    lastMessageWasBrief.set(chatId, false);

    let agentReply: string;

    // Priority 1: resolve a pending capture clarification
    const pendingCapture = pending.get(chatId);
    if (pendingCapture) {
      pending.delete(chatId);
      agentReply = await resolvePending(userMessage, pendingCapture.originalMessage, pendingCapture.classification, history);

    // Priority 2: reply to evening check-in → write log
    } else if (lastMessageWasEveningCheckIn.get(chatId)) {
      lastMessageWasEveningCheckIn.set(chatId, false);
      console.log(`[${ts()}] routing to evening log write`);
      await writeEveningLog(userMessage);
      agentReply = 'logged.';

    // Priority 3: brief reply with energy + hours → day plan
    } else if (wasBrief) {
      const energyMatch = userMessage.match(/\b([1-9]|10)\b/);
      const hoursMatch = userMessage.match(/(\d+\.?\d*)\s*(?:hr|hrs|hour|hours)/i);
      if (energyMatch && hoursMatch) {
        const energy = parseInt(energyMatch[1], 10);
        const hours = parseFloat(hoursMatch[1]);
        console.log(`[${ts()}] routing to day plan — energy: ${energy}, hours: ${hours}`);
        agentReply = await runDayPlan(energy, hours);
      } else {
        console.log(`[bot] routing to agent loop: ${userMessage.slice(0, 50)}`);
        agentReply = await runAgentLoop(userMessage, history);
      }

    // Priority 4: explicit capture keyword → capture pipeline
    } else if (isExplicitCapture(userMessage)) {
      console.log(`[${ts()}] routing to capture pipeline`);
      const result = await runCapturePipeline(userMessage, history, contentType);
      if (result.type === 'clarify') {
        pending.set(chatId, { classification: result.classification, originalMessage: userMessage });
        await ctx.reply(result.question);
        return;
      }
      agentReply = result.message;

    // Default: agent loop with conversation history
    } else {
      console.log(`[bot] routing to agent loop: ${userMessage.slice(0, 50)}`);
      agentReply = await runAgentLoop(userMessage, history);
    }

    // Flag if this reply was a morning brief (so next message can be brief_reply)
    if (agentReply.includes("what's your energy") || agentReply.includes('hours free today')) {
      lastMessageWasBrief.set(chatId, true);
    }

    // Update in-memory conversation history (keep last 6 messages)
    history.push({ role: 'user', content: userMessage });
    history.push({ role: 'assistant', content: agentReply });
    if (history.length > 6) history.splice(0, 2);

    await logMessage(chatId, 'assistant', agentReply);
    await ctx.reply(replyPrefix + formatForTelegram(agentReply), { parse_mode: 'HTML' });
    console.log(`[${ts()}] caterina: ${agentReply.slice(0, 80)}...`);
  } catch (err) {
    console.error('error:', err);
    if (isCreditsError(err)) {
      await ctx.reply('⚠️ anthropic api credits are out — bot is down until you top up.\ngo to console.anthropic.com → billing');
      return;
    }
    await ctx.reply('something went wrong. please try again.');
  }
}

function ts() {
  return new Date().toISOString();
}
