import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TOOLS } from './tools';
import { executeTool } from './execute';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MAX_ITERATIONS = 10;

const NOTION_CONTEXT = `

## notion tools

- read_notion_tasks: reads all active tasks from Andrew's task board. returns name, priority, project, time estimate, energy, why. call this whenever asked about tasks or generating a morning brief. never generate tasks from context.
- write_notion_task: creates a new task and returns its page_id — use it directly for any immediate follow-up updates without calling read_notion_tasks again.
- update_notion_task_status: updates any task fields — status, priority, energy, time estimate, and/or project. pass only the fields you want to change.
- read_training_today: returns today's training session from the 16-week plan
- read_sketching_today: returns the next incomplete sketching session
- mark_training_done: marks today's training as complete (pass page_id from read_training_today)
- mark_sketching_done: marks current sketching session complete (pass page_id)

all tasks — Lost Marbles, Abstracted Objects, Blender, Sketching, Personal — go to the Andrew Task Board only. never invent tasks from context.

## notion search tools

- search_notion: search the workspace for any page or database by name. use before reading to find the right page ID.
- read_notion_page: read full content of any page by id. use after search_notion to get actual pipeline docs, project pages, or reference material.

## life task tools

- read_life_tasks: reads Andrew's personal todos from Google Tasks (groceries, errands, personal)
- write_life_task: adds a personal todo to Google Tasks
- complete_life_task: marks a personal todo as done (pass task_id from read_life_tasks)`;

const webSearchTool = {
  type: 'web_search_20250305',
  name: 'web_search',
} as unknown as Anthropic.Tool;

const allTools: Anthropic.Tool[] = [...TOOLS, webSearchTool];

export function initAgentTools(): void {
  console.log('[agent] NOTION_API_KEY set:', !!process.env.NOTION_API_KEY);
  console.log('[agent] NOTION_TASKS_DB_ID:', process.env.NOTION_TASKS_DB_ID ?? '(using default)');
  console.log('[agent] NOTION_TRAINING_DB_ID:', process.env.NOTION_TRAINING_DB_ID ?? '(not set)');
  console.log('[agent] NOTION_SKETCHING_DB_ID:', process.env.NOTION_SKETCHING_DB_ID ?? '(not set)');
  console.log(`[agent] ${allTools.length} tools registered`);
  console.log('[agent] update tool fields:', JSON.stringify(allTools.find(t => t.name === 'update_notion_task_status')));
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
  conversationHistory?: Array<{ role: string; content: string }>
): Promise<string> {
  const systemPrompt = loadSystemPrompt();

  const messages: Anthropic.MessageParam[] = [
    ...(conversationHistory ?? []).map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    })),
    { role: 'user', content: userMessage },
  ];

  let iteration = 0;
  while (true) {
    if (iteration >= MAX_ITERATIONS) throw new Error('Agent loop exceeded maximum iterations');

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools: allTools,
      tool_choice: { type: 'auto' },
      messages,
    });
    iteration++;

    if (response.stop_reason === 'end_turn') {
      const text = response.content.find(b => b.type === 'text');
      if (!text || text.type !== 'text') throw new Error('No text in final response');
      const toolCalledThisIteration = response.content.some(b => b.type === 'tool_use');
      if (!toolCalledThisIteration && /updated|done|marked|changed|set /i.test(text.text)) {
        console.warn('[agent] WARNING: response claims update but no tool was called');
      }
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
}
