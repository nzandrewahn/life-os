import { Telegraf, type Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { runAgentLoop } from './agent/loop';
import { logMessage, getRecentHistory } from './db';
import { transcribeVoice } from './integrations/groq';
import { formatForTelegram, escapeHtml } from './utils/formatter';
import { runCapturePipeline, resolvePending } from './capture/pipeline';
import type { Classification } from './capture/classify';

const ALLOWED_CHAT_ID = process.env.TELEGRAM_CHAT_ID!;

const CAPTURE_TRIGGERS = [
  'save', 'note', 'capture', 'remember',
  'add task', 'add to', 'file this', 'log this',
];

function isCaptureIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return CAPTURE_TRIGGERS.some(trigger => lower.includes(trigger));
}

interface PendingCapture {
  classification: Classification;
  originalMessage: string;
}
const pending = new Map<string, PendingCapture>();

export function createBot(): Telegraf {
  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

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
    } else if (contentType === 'voice' || isCaptureIntent(userMessage)) {
      // Voice always captures; text only if explicit intent
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
    await ctx.reply('something went wrong. please try again.');
  }
}

function ts() {
  return new Date().toISOString();
}
