import cron from 'node-cron';
import type { Telegram } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { readCalendarEvents } from '../integrations/google-calendar';
import { queryTasks } from '../integrations/notion';

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

async function runMorningBrief(telegram: Telegram): Promise<void> {
  console.log('[cron] morning brief starting');
  const supabase = getSupabase();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: AUCKLAND });

  const [
    notionTasks,
    { data: lifeTasks },
    events,
  ] = await Promise.all([
    queryTasks().catch(err => {
      console.error('[cron] notion tasks fetch failed:', err.message);
      return [];
    }),
    supabase
      .from('life_tasks')
      .select('title, category, priority, due_date')
      .eq('status', 'pending'),
    readCalendarEvents(1).catch(err => {
      console.error('[cron] calendar fetch failed:', err.message);
      return [];
    }),
  ]);

  // Show subtasks inline, skip parent tasks that have sub-items
  const displayTasks = notionTasks.filter(t => !t.hasSubItems);

  const taskLines = displayTasks.map(t =>
    `${t.timeEstimate ? `${t.timeEstimate}h` : '?h'} ${t.name}${t.project ? ` (${t.project})` : ''}${t.why ? `\n   why: ${t.why}` : ''}`
  ).join('\n\n');

  const calendarLines = events.map(e =>
    `${e.startAuckland} ${e.title}`
  ).join('\n');

  const lifeLines = (lifeTasks ?? []).map(t => `${t.title}`).join('\n');

  const totalEstimated = displayTasks.reduce((sum, t) => sum + (t.timeEstimate ?? 0), 0);

  const prompt = `generate a morning brief for ${today} in this exact format, all lowercase, no asterisks, no markdown:

good morning.

— today —
${taskLines || 'no open tasks'}

— calendar —
${calendarLines || 'nothing scheduled'}
${lifeLines ? `\n— life —\n${lifeLines}` : ''}

${totalEstimated}h of tasks open

reply with energy (1–10) and hours available.

keep it exactly as shown. do not add commentary, do not add headers like "**today**". output only the brief.`;

  const brief = await generateMessage(prompt);
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

  // Group by classification
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
