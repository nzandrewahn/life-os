import { Telegraf, type Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runAgentLoop } from './agent/loop';
import { generateMorningBrief, writeEveningLog } from './crons';
import { runDayPlan } from './agent/dayplan';
import { lastMessageWasEveningCheckIn } from './state';
import { logMessage, getRecentHistory } from './db';
import { transcribeVoice } from './integrations/groq';
import { formatForTelegram, escapeHtml } from './utils/formatter';
import { isCreditsError } from './utils/errors';
import { runCapturePipeline, resolvePending } from './capture/pipeline';
import type { Classification } from './capture/classify';

const ALLOWED_CHAT_ID = process.env.TELEGRAM_CHAT_ID!;

const CAPTURE_TRIGGERS = [
  'save', 'note', 'capture', 'remember',
  'add task', 'add to', 'file this', 'log this',
];

const MORNING_BRIEF_TRIGGERS = [
  'morning brief', 'good morning', 'my brief',
  'what do i have today', 'daily brief',
];

function isCaptureIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return CAPTURE_TRIGGERS.some(trigger => lower.includes(trigger));
}

function isMorningBrief(text: string): boolean {
  const lower = text.toLowerCase();
  return MORNING_BRIEF_TRIGGERS.some(t => lower.includes(t));
}

interface PendingCapture {
  classification: Classification;
  originalMessage: string;
}
const pending = new Map<string, PendingCapture>();
const lastMessageWasBrief = new Map<string, boolean>();

function isEnergyReply(text: string): { energy: number; hours: number } | null {
  const energyMatch = text.match(/\b([1-9]|10)\b/);
  const hoursMatch = text.match(/(\d+\.?\d*)\s*(?:hr|hrs|hour|hours)/i);
  if (energyMatch && hoursMatch) {
    return {
      energy: parseInt(energyMatch[1], 10),
      hours: parseFloat(hoursMatch[1]),
    };
  }
  return null;
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

    const history = await getRecentHistory(chatId);
    await logMessage(chatId, 'user', userMessage);

    let agentReply: string;

    // Resolve pending capture clarification first
    const pendingCapture = pending.get(chatId);
    if (pendingCapture) {
      pending.delete(chatId);
      agentReply = await resolvePending(
        userMessage,
        pendingCapture.originalMessage,
        pendingCapture.classification,
        history
      );
    } else if (lastMessageWasEveningCheckIn.get(chatId)) {
      lastMessageWasEveningCheckIn.set(chatId, false);
      console.log(`[${ts()}] routing to evening log write`);
      await writeEveningLog(userMessage);
      agentReply = 'logged.';
    } else if (lastMessageWasBrief.get(chatId)) {
      const parsed = isEnergyReply(userMessage);
      if (parsed) {
        console.log(`[${ts()}] routing to day plan — energy: ${parsed.energy}, hours: ${parsed.hours}`);
        lastMessageWasBrief.set(chatId, false);
        agentReply = await runDayPlan(parsed.energy, parsed.hours);
      } else {
        lastMessageWasBrief.set(chatId, false);
        agentReply = await runAgentLoop(userMessage, history);
      }
    } else if (isMorningBrief(userMessage)) {
      console.log(`[${ts()}] routing to morning brief`);
      agentReply = await generateMorningBrief();
      lastMessageWasBrief.set(chatId, true);
    } else if (isCaptureIntent(userMessage)) {
      // Only route to capture if message contains explicit trigger keywords
      console.log(`[${ts()}] routing to capture pipeline`);
      const result = await runCapturePipeline(userMessage, history, contentType);

      if (result.type === 'clarify') {
        pending.set(chatId, { classification: result.classification, originalMessage: userMessage });
        await ctx.reply(result.question);
        return;
      }

      agentReply = result.message;
    } else {
      // Default: conversational agent loop
      console.log(`[${ts()}] routing to agent loop`);
      agentReply = await runAgentLoop(userMessage, history);
    }

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
