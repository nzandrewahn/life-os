import Anthropic from '@anthropic-ai/sdk';
import type { DbMessage } from './types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are Caterina, a personal AI assistant living in Telegram. Help with planning, thinking, writing, or anything else the user needs. Be concise and direct. Use conversation history to maintain context across days.`;

export async function getClaudeResponse(
  userMessage: string,
  history: DbMessage[]
): Promise<string> {
  const historyMessages: Anthropic.MessageParam[] = history.map((msg, i) => {
    const isLast = i === history.length - 1;
    return {
      role: msg.role,
      content: isLast
        ? [{ type: 'text', text: msg.content, cache_control: { type: 'ephemeral' } }]
        : msg.content,
    };
  });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      ...historyMessages,
      { role: 'user', content: userMessage },
    ],
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
  return block.text;
}
