import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TOOLS } from './tools';
import { executeTool } from './execute';
import type { DbMessage } from '../types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MAX_ITERATIONS = 10;

const NOTION_CONTEXT = `

## notion tools

- read_notion_tasks: reads all active tasks from Andrew's task board. returns name, priority, project, time estimate, energy, why. call this whenever asked about tasks or generating a morning brief. never generate tasks from context.
- write_notion_task: creates a new task in the task board
- update_notion_task_status: updates any task fields — status, priority, energy, time estimate, and/or project. pass only the fields you want to change.
- read_training_today: returns today's training session from the 16-week plan
- read_sketching_today: returns the next incomplete sketching session
- mark_training_done: marks today's training as complete (pass to_do_block_id)
- mark_sketching_done: marks current sketching session complete (pass page_id)

all tasks — Lost Marbles, Abstracted Objects, Blender, Sketching, Personal — go to the Andrew Task Board only. never invent tasks from context.`;

const allTools: Anthropic.Tool[] = [...TOOLS];

export function initAgentTools(): void {
  console.log('[agent] NOTION_API_KEY set:', !!process.env.NOTION_API_KEY);
  console.log('[agent] NOTION_TASKS_DB_ID:', process.env.NOTION_TASKS_DB_ID ?? '(using default)');
  console.log('[agent] NOTION_TRAINING_PAGE_ID:', process.env.NOTION_TRAINING_PAGE_ID ?? '(not set)');
  console.log('[agent] NOTION_SKETCHING_DB_ID:', process.env.NOTION_SKETCHING_DB_ID ?? '(not set)');
  console.log(`[agent] ${allTools.length} tools registered`);
}

function loadSystemPrompt(): string {
  let base: string;
  try {
    base = readFileSync(join(process.cwd(), 'system-prompt.md'), 'utf-8');
  } catch {
    base = 'You are Caterina, a personal AI assistant. Rules: all lowercase, no markdown, no headers, no bullet asterisks, under 10 words where possible, no filler phrases, no motivational language.';
  }
  try {
    const updates = readFileSync(join(process.cwd(), 'context-updates.md'), 'utf-8');
    if (updates.trim()) return `${base}${NOTION_CONTEXT}\n\n## dynamic context updates\n\n${updates}`;
  } catch {
    // file doesn't exist yet — skip silently
  }
  return `${base}${NOTION_CONTEXT}`;
}

export async function runAgentLoop(
  userMessage: string,
  history: DbMessage[]
): Promise<string> {
  const systemPrompt = loadSystemPrompt();

  const messages: Anthropic.MessageParam[] = [
    ...history.map((msg, i) => ({
      role: msg.role as 'user' | 'assistant',
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
      tools: allTools,
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
