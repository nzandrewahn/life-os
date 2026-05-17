import Anthropic from '@anthropic-ai/sdk';
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
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type Intent = 'capture' | 'task_update' | 'life_task' | 'brief_reply' | 'conversation';

async function classifyIntent(userMessage: string, wasBrief: boolean): Promise<Intent> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 20,
    messages: [{
      role: 'user',
      content: `Classify this message into exactly one category:

capture — user is saving a thought, idea, insight, learning, reference or note for their second brain. Usually starts with "capture", "note", "save", "insight", "learned" but not always. Must be something worth keeping.

task_update — user wants to update a work task's status, priority, energy, project or time estimate in their Notion task board.

life_task — user wants to add, complete, or check personal todos: groceries, errands, appointments, reminders, or anything not related to a work project.

brief_reply — user is replying to their morning brief with their energy level and hours available for the day.
${wasBrief ? 'IMPORTANT: the last message WAS a morning brief, so this is likely a brief_reply if it contains a number.' : 'The last message was NOT a morning brief.'}

conversation — anything else: questions, requests for info, commands, general chat, asking what Caterina can do, etc.

IMPORTANT: if the message appears to be a reply to something Caterina just said — agreeing, disagreeing, giving feedback, confirming, or refining a plan — classify it as conversation, NOT capture.

Captures are only when Andrew is explicitly saving something for his second brain, not when he's responding to Caterina in a back-and-forth.

Signs it's a conversation reply:
- references to 'existing', 'proposed', numbered items
- words like 'combine', 'separate', 'merge', 'keep'
- agreeing or disagreeing with a previous message
- giving instructions to Caterina about what to do

Signs it's a capture:
- explicitly starts with capture/note/save/insight
- standalone thought with no reference to prior context

Message: "${userMessage}"

Reply with only one word: capture, task_update, life_task, brief_reply, or conversation.`,
    }],
  });

  const text = response.content.find(b => b.type === 'text')?.text.trim().toLowerCase() ?? '';
  if (text === 'capture') return 'capture';
  if (text === 'task_update') return 'task_update';
  if (text === 'life_task') return 'life_task';
  if (text === 'brief_reply') return 'brief_reply';
  return 'conversation';
}

interface PendingCapture {
  classification: Classification;
  originalMessage: string;
}
const pending = new Map<string, PendingCapture>();
const lastMessageWasBrief = new Map<string, boolean>();

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

    // Pending capture clarification takes priority — no intent classification needed
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
    } else {
      const wasBrief = lastMessageWasBrief.get(chatId) ?? false;
      const intent = await classifyIntent(userMessage, wasBrief);
      console.log(`[bot] intent classified: ${intent} for message: ${userMessage.slice(0, 50)}`);

      lastMessageWasBrief.set(chatId, false);

      if (intent === 'capture') {
        console.log(`[${ts()}] routing to capture pipeline`);
        const result = await runCapturePipeline(userMessage, history, contentType);
        if (result.type === 'clarify') {
          pending.set(chatId, { classification: result.classification, originalMessage: userMessage });
          await ctx.reply(result.question);
          return;
        }
        agentReply = result.message;
      } else if (intent === 'task_update') {
        console.log(`[${ts()}] routing to agent loop (task update)`);
        agentReply = await runAgentLoop(userMessage, history);
      } else if (intent === 'life_task') {
        console.log(`[${ts()}] routing to agent loop (life task)`);
        agentReply = await runAgentLoop(userMessage, history);
      } else if (intent === 'brief_reply') {
        const energyMatch = userMessage.match(/\b([1-9]|10)\b/);
        const hoursMatch = userMessage.match(/(\d+\.?\d*)\s*(?:hr|hrs|hour|hours)/i);
        if (energyMatch && hoursMatch) {
          const energy = parseInt(energyMatch[1], 10);
          const hours = parseFloat(hoursMatch[1]);
          console.log(`[${ts()}] routing to day plan — energy: ${energy}, hours: ${hours}`);
          agentReply = await runDayPlan(energy, hours);
        } else {
          // Classified as brief_reply but couldn't parse numbers — fall through to agent
          agentReply = await runAgentLoop(userMessage, history);
        }
      } else {
        console.log(`[${ts()}] routing to agent loop`);
        agentReply = await runAgentLoop(userMessage, history);
        if (agentReply.includes('what\'s your energy') || agentReply.includes('hours free today')) {
          lastMessageWasBrief.set(chatId, true);
        }
      }
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
