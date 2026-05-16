import cron from 'node-cron';
import type { Telegram } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runAgentLoop } from '../agent/loop';

const AUCKLAND = 'Pacific/Auckland';

function getSupabase() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
}

function getAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

function loadSystemPrompt(): string {
  try {
    return readFileSync(join(process.cwd(), 'system-prompt.md'), 'utf-8');
  } catch {
    return 'You are Caterina, a personal AI assistant. all lowercase, no markdown, no headers, under 10 words where possible, no filler.';
  }
}

function getChatId(): string {
  const id = process.env.TELEGRAM_CHAT_ID;
  if (!id) throw new Error('[cron] TELEGRAM_CHAT_ID is not set');
  return id;
}

async function generateMessage(prompt: string): Promise<string> {
  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    system: loadSystemPrompt(),
    messages: [{ role: 'user', content: prompt }],
  });
  const block = response.content.find(b => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('[cron] no text block in response');
  return block.text;
}

export async function generateMorningBrief(): Promise<string> {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: AUCKLAND });

  return runAgentLoop(
    `generate morning brief for ${today}.

CRITICAL: Before generating the morning brief, you MUST call read_notion_tasks to get the actual current tasks. Never generate or assume tasks from context. If read_notion_tasks returns empty, say "no tasks found" in the today section. Never hallucinate tasks.

steps — call ALL of these tools before writing anything:
1. call read_notion_tasks — REQUIRED. use the returned tasks only. do not invent tasks.
2. call read_training_today — get today's session
3. call read_sketching_today — get today's sketching session
4. call read_google_calendar with days=1 — get today's events
5. call read_supabase_history with days=1 — check for pending life tasks

format exactly as shown below. all lowercase. no asterisks. no markdown symbols. no commentary.

good morning.

— today —
[list tasks returned by read_notion_tasks only, up to 5: Critical first, then High, then Normal, then Low. omit Done and Paused. omit sub-tasks — show parent tasks only, unless the parent is Paused then show first sub-task instead. if read_notion_tasks returned no tasks write "no tasks found"]
[Xhr, energy] task name (project)
why: one line

— training —
[session text from read_training_today, or omit this section entirely if the tool errored]

— sketching —
[session title from read_sketching_today, or omit this section entirely if the tool errored]
warm-up: straight lines then ellipses, 5 min

— calendar —
[time] event name

— life —
[pending life tasks if any — omit this section entirely if none]

what's your energy (1–10) and hours available?

field rules:
- time estimate: show as [Xhr] — use [?hr] if missing
- energy: second value in brackets [Xhr, energy] — omit if missing
- project in parentheses after task name
- why: one line max, omit the line if why field is empty
- max 5 tasks total in today section`,
    [],
  );
}

async function runMorningBrief(telegram: Telegram): Promise<void> {
  console.log('[cron] morning brief starting');
  const brief = await generateMorningBrief();
  await telegram.sendMessage(getChatId(), brief);
  console.log('[cron] morning brief sent');
}

async function runEveningCheckIn(telegram: Telegram): Promise<void> {
  console.log('[cron] evening check-in starting');
  await telegram.sendMessage(getChatId(), 'what got done today? anything to carry forward?');
  console.log('[cron] evening check-in sent');
}

async function runWeeklyDigest(telegram: Telegram): Promise<void> {
  console.log('[cron] weekly digest starting');
  const supabase = getSupabase();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: captures, error } = await supabase
    .from('captures')
    .select('id, raw_content, summary, classification, project, routed_to, created_at')
    .eq('reviewed', false)
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`[cron] captures query failed: ${error.message}`);

  if (!captures?.length) {
    console.log('[cron] weekly digest: no unreviewed captures, skipping');
    return;
  }

  const grouped: Record<string, typeof captures> = {};
  for (const c of captures) {
    const key = c.classification ?? 'unclassified';
    (grouped[key] ??= []).push(c);
  }

  const groupedText = Object.entries(grouped)
    .map(([type, items]) =>
      `${type} (${items.length}):\n${items.map(i => `  - ${i.summary ?? i.raw_content}`).join('\n')}`
    )
    .join('\n\n');

  const prompt = `generate weekly digest. unreviewed captures from the past 7 days:

${groupedText}

summarise what was captured, call out any themes or patterns, flag anything that needs action.`;

  const digest = await generateMessage(prompt);
  await telegram.sendMessage(getChatId(), digest);

  const ids = captures.map(c => c.id);
  const { error: updateError } = await supabase
    .from('captures')
    .update({ reviewed: true })
    .in('id', ids);

  if (updateError) console.error('[cron] failed to mark captures reviewed:', updateError.message);
  else console.log(`[cron] weekly digest sent, ${ids.length} captures marked reviewed`);
}

function schedule(expression: string, label: string, fn: () => Promise<void>): void {
  cron.schedule(expression, async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`[cron] ${label} failed:`, err instanceof Error ? err.message : err);
      if (err instanceof Error) console.error(err.stack);
    }
  }, { timezone: AUCKLAND });
}

export function startCrons(telegram: Telegram): void {
  // Morning brief — 7:00am daily
  schedule('0 7 * * *', 'morning brief', () => runMorningBrief(telegram));

  // Evening check-in — 1:00am Mon–Thu (late night after work day)
  schedule('0 1 * * 1-4', 'evening check-in (weekday)', () => runEveningCheckIn(telegram));

  // Evening check-in — 9:00pm Fri–Sun
  schedule('0 21 * * 5,6,0', 'evening check-in (weekend)', () => runEveningCheckIn(telegram));

  // Weekly digest — 6:00pm Sunday
  schedule('0 18 * * 0', 'weekly digest', () => runWeeklyDigest(telegram));

  console.log('[cron] 4 jobs registered (Pacific/Auckland)');
  console.log('[cron]   morning brief:      0 7 * * *');
  console.log('[cron]   evening (weekday):  0 1 * * 1-4');
  console.log('[cron]   evening (weekend):  0 21 * * 5,6,0');
  console.log('[cron]   weekly digest:      0 18 * * 0');
}
