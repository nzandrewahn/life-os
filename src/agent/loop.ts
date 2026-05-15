import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TOOLS } from './tools';
import { executeTool } from './execute';
import type { DbMessage } from '../types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MAX_ITERATIONS = 10;

function loadSystemPrompt(): string {
  let base: string;
  try {
    base = readFileSync(join(process.cwd(), 'system-prompt.md'), 'utf-8');
  } catch {
    base = 'You are Caterina, a personal AI assistant. Rules: all lowercase, no markdown, no headers, no bullet asterisks, under 10 words where possible, no filler phrases, no motivational language.';
  }
  try {
    const updates = readFileSync(join(process.cwd(), 'context-updates.md'), 'utf-8');
    if (updates.trim()) return `${base}\n\n## dynamic context updates\n\n${updates}`;
  } catch {
    // file doesn't exist yet — skip silently
  }
  return base;
}

export async function runAgentLoop(
  userMessage: string,
  history: DbMessage[]
): Promise<string> {
  const systemPrompt = loadSystemPrompt();

  const messages: Anthropic.MessageParam[] = [
    ...history.map((msg, i) => ({
      role: msg.role as 'user' | 'assistant',
      // Cache the last history message — stable context that won't change this run
      content: i === history.length - 1
        ? [{ type: 'text' as const, text: msg.content, cache_control: { type: 'ephemeral' as const } }]
        : msg.content,
    })),
    { role: 'user', content: userMessage },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason === 'end_turn') {
      const text = response.content.find(b => b.type === 'text');
      if (!text || text.type !== 'text') throw new Error('No text in final response');
      return text.text;
    }

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      const results: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        console.log(`[tool] ${block.name}`, JSON.stringify(block.input));
        try {
          const result = await executeTool(block.name, block.input as Record<string, unknown>);
          console.log(`[tool] ${block.name} → ok`);
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result, null, 2),
          });
        } catch (err) {
          console.error(`[tool] ${block.name} → error:`, err);
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
            is_error: true,
          });
        }
      }

      messages.push({ role: 'user', content: results });
      continue;
    }

    throw new Error(`Unexpected stop reason: ${response.stop_reason}`);
  }

  throw new Error('Agent loop exceeded maximum iterations');
}
