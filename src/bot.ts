import { Telegraf, type Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { runAgentLoop } from './agent/loop';
import { logMessage, getRecentHistory } from './db';
import { transcribeVoice } from './integrations/groq';
import { formatForTelegram, escapeHtml } from './utils/formatter';

const ALLOWED_CHAT_ID = process.env.TELEGRAM_CHAT_ID!;

export function createBot(): Telegraf {
  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

  bot.on(message('text'), async (ctx) => {
    const chatId = String(ctx.chat.id);
    if (chatId !== ALLOWED_CHAT_ID) {
      console.log(`Ignored unauthorized chat: ${chatId}`);
      return;
    }
    await handleMessage(ctx, chatId, ctx.message.text);
  });

  bot.on(message('voice'), async (ctx) => {
    const chatId = String(ctx.chat.id);
    if (chatId !== ALLOWED_CHAT_ID) {
      console.log(`Ignored unauthorized chat: ${chatId}`);
      return;
    }

    try {
      await ctx.sendChatAction('typing');
      const transcript = await transcribeVoice(ctx.message.voice.file_id);
      console.log(`[${new Date().toISOString()}] Voice → "${transcript}"`);
      await handleMessage(ctx, chatId, transcript, `heard: ${escapeHtml(transcript)}\n\n`);
    } catch (err) {
      console.error('Transcription error:', err);
      await ctx.reply('could not transcribe voice message. please try again.');
    }
  });

  return bot;
}

async function handleMessage(
  ctx: Context,
  chatId: string,
  userMessage: string,
  replyPrefix = ''
) {
  console.log(`[${new Date().toISOString()}] User: ${userMessage}`);
  try {
    await ctx.sendChatAction('typing');

    const history = await getRecentHistory(chatId);
    await logMessage(chatId, 'user', userMessage);

    const agentReply = await runAgentLoop(userMessage, history);
    await logMessage(chatId, 'assistant', agentReply);

    await ctx.reply(replyPrefix + formatForTelegram(agentReply), { parse_mode: 'HTML' });
    console.log(`[${new Date().toISOString()}] Caterina: ${agentReply.slice(0, 80)}...`);
  } catch (err) {
    console.error('Error:', err);
    await ctx.reply('something went wrong. please try again.');
  }
}
