import cron from 'node-cron';
import type { Telegram } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { runAgentLoop } from '../agent/loop';
import { appendToNote, buildNote } from '../integrations/obsidian';
import { setEveningCheckInSent } from '../state';
import { readCalendarEvents } from '../integrations/google-calendar';
import { readNotionTasks, readTrainingToday } from '../integrations/notion';
import {
  getActiveCommitments,
  getOverdueCommitments,
  getDueTodayCommitments,
} from '../integrations/goals';

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
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: loadSystemPrompt(),
    messages: [{ role: 'user', content: prompt }],
  });
  const block = response.content.find(b => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('[cron] no text block in response');
  return block.text;
}

async function generateFocusAndQuote(): Promise<{ focus: string; quote: string }> {
  const [focus, quote] = await Promise.all([
    generateMessage(
      `Based on Andrew's life context in the system prompt, write a 1-2 sentence morning reminder about the phase he's currently in — building the base, clearing debt, stacking toward his financial goal. Speak to the grind of right now, not the destination. Tone: mentor, direct, quiet. All lowercase. No fluff. Vary the angle each day so it doesn't feel repetitive. Reply with only the sentence(s), nothing else.`
    ),
    generateMessage(
      `Based on Andrew's current life phase, goals, and what he's building, choose a short quote that resonates with where he is right now. It should feel like it was picked for today, not randomly selected. Source it from memory — a real line from a real person. Reply in this exact format and nothing else:\n"[quote]" — [author]`
    ),
  ]);
  return { focus: focus.trim(), quote: quote.trim() };
}

export async function generateMorningBrief(): Promise<string> {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: AUCKLAND });

  const [overdue, dueToday] = await Promise.all([
    getOverdueCommitments().catch(() => []),
    getDueTodayCommitments().catch(() => []),
  ]);

  const commitmentContext = (overdue.length > 0 || dueToday.length > 0)
    ? `\nOverdue commitments: ${JSON.stringify(overdue)}\nDue today: ${JSON.stringify(dueToday)}`
    : '\nNo overdue or due-today commitments.';

  const [brief, { focus, quote }] = await Promise.all([
    runAgentLoop(
      `generate morning brief for ${today}.
${commitmentContext}

CRITICAL: Before generating the morning brief, you MUST call read_notion_tasks to get the actual current tasks. Never generate or assume tasks from context. If read_notion_tasks returns empty, say "no tasks found" in the today section. Never hallucinate tasks.

steps — call ALL of these tools before writing anything:
1. call read_notion_tasks — REQUIRED. use the returned tasks only. do not invent tasks.
2. call read_training_today — get today's session
3. call read_sketching_today — get today's sketching session
4. call read_google_calendar with days=1 — get today's events
5. call read_life_tasks — get personal todos from Google Tasks

format exactly as shown below. all lowercase. no asterisks. no markdown symbols. no commentary.

good morning.

— on deck —
[list all active tasks returned by read_notion_tasks. omit Done and Paused. omit sub-tasks — show parent tasks only, unless the parent is Paused then show first sub-task instead. if read_notion_tasks returned no tasks write "no tasks found". no priority ordering — show as inventory.]
[Xhr, energy] task name (project)

— training —
[name from read_training_today, lowercase, e.g. "week 1 — day 2"]
[session text from read_training_today, or omit this section entirely if the tool errored]

— sketching —
[session title from read_sketching_today, or omit this section entirely if the tool errored]
warm-up: straight lines then ellipses, 5 min

— calendar —
[time] event name

— life —
[pending life tasks from read_life_tasks if any — omit this section entirely if none]

— commitments —
[use the pre-fetched overdue and due-today commitment data injected above. for each: show the commitment statement and deadline. prefix overdue items with ⚠ and show days overdue. prefix due-today items with ⚠. omit this section entirely if no overdue or due-today commitments.]

what's your energy (1–10) and hours free today?

field rules:
- time estimate: show as [Xhr] — use [?hr] if missing
- energy: second value in brackets [Xhr, energy] — omit if missing
- project in parentheses after task name
- no why field`,
      [],
    ),
    generateFocusAndQuote(),
  ]);

  return `${brief}\n\n— focus —\n${focus}\n\n${quote}`;
}

async function runMorningBrief(telegram: Telegram): Promise<void> {
  console.log('[cron] morning brief starting');
  const brief = await generateMorningBrief();
  await telegram.sendMessage(getChatId(), brief);
  console.log('[cron] morning brief sent');
}

async function generateTomorrowPreview(): Promise<string> {
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = tomorrowDate.toLocaleDateString('sv-SE', { timeZone: AUCKLAND }); // YYYY-MM-DD

  const [tasks, events, training] = await Promise.all([
    readNotionTasks(),
    readCalendarEvents(2),
    readTrainingToday(),
  ]);

  const tomorrowEvents = events.filter(e => e.start.startsWith(tomorrowStr) && !e.allDay);

  const priorityOrder = ['Critical', 'High', 'Normal', 'Low'];
  const topTasks = [...tasks]
    .sort((a, b) => priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority))
    .slice(0, 2);

  const lines: string[] = ['— tomorrow —'];

  if (tomorrowEvents.length > 0) {
    tomorrowEvents.forEach(e => lines.push(e.startAuckland.replace(/^.*, /, '') + ' ' + e.title.toLowerCase()));
  }

  if (training.session && training.session !== 'rest day' && training.session !== 'all sessions complete') {
    const label = training.name ? training.name.toLowerCase() : 'training';
    lines.push(`training: ${label}`);
  }

  topTasks.forEach(t => lines.push(t.name.toLowerCase()));

  return lines.join('\n');
}

async function runEveningCheckIn(telegram: Telegram): Promise<void> {
  console.log('[cron] evening check-in starting');
  const chatId = getChatId();

  let message = 'what got done today? anything to carry forward?';
  try {
    const preview = await generateTomorrowPreview();
    message += `\n\n${preview}`;
  } catch (err) {
    console.error('[cron] tomorrow preview failed:', err instanceof Error ? err.message : err);
  }

  try {
    const [overdue, dueToday] = await Promise.all([
      getOverdueCommitments(),
      getDueTodayCommitments(),
    ]);

    const flagged = [...overdue, ...dueToday];
    if (flagged.length > 0) {
      const lines = flagged.map(c => {
        const isOverdue = overdue.some(o => o.id === c.id);
        const daysOverdue = isOverdue
          ? Math.floor((Date.now() - new Date(c.deadline!).getTime()) / 86400000)
          : 0;
        const prefix = isOverdue ? `⚠ ${daysOverdue}d overdue` : '⚠ due today';
        return `${prefix}: ${c.statement}`;
      });
      message += `\n\n— on track? —\n${lines.join('\n')}`;
    }
  } catch (err) {
    console.error('[cron] commitment check failed:', err instanceof Error ? err.message : err);
  }

  await telegram.sendMessage(chatId, message);
  setEveningCheckInSent(chatId);
  console.log('[cron] evening check-in sent');
}

export async function writeEveningLog(content: string): Promise<void> {
  const date = new Date().toLocaleDateString('sv-SE', { timeZone: AUCKLAND });
  const path = `2.Notes/Daily/${date}.md`;
  const note = buildNote({ title: date, content, type: 'daily' });
  await appendToNote(path, note);
  console.log('[cron] evening log written to:', path);
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

const PRINCIPLES = [
  "I am the type of person that devotes himself to the craft and not on an outcome.",
  "I am the type of person that doesn't let fear control his life.",
  "I am the type of person that makes financially responsible decisions.",
  "I am the type of person that does what he says.",
  "I am the type of person that applies himself to the work he does.",
  "I am the type of person that is not afraid to knock.",
  "I am the type of person that finds fulfilment in the process.",
  "I am the type of person that is able to work without people looking.",
  "I am the type of person that is able to understand that being alone doesn't mean I am alone.",
  "I am the type of person that doesn't let anger control him.",
  "I am the type of person that creates more than he consumes.",
  "The entire world is fucking malleable. All the rules and things you think can't be broken are all illusions.",
];

let pingCount = 0;

function getNextPrinciple(): string {
  const principle = PRINCIPLES[pingCount % PRINCIPLES.length];
  pingCount++;
  return principle;
}

export function startCrons(telegram: Telegram): void {
  const sendMessage = (text: string) => telegram.sendMessage(getChatId(), text);

  // Morning brief — 8:00am daily
  schedule('0 8 * * *', 'morning brief', () => runMorningBrief(telegram));

  // Evening check-in — 1:00am Tue–Fri (after Mon–Thu work shifts ending at 12:30am)
  schedule('0 1 * * 2-5', 'evening check-in (post-work)', () => runEveningCheckIn(telegram));

  // Evening check-in — 10:00pm Sun–Mon (rest nights before days off)
  schedule('0 22 * * 0,1', 'evening check-in (rest day)', () => runEveningCheckIn(telegram));

  // Weekly digest — 6:00pm Sunday
  schedule('0 18 * * 0', 'weekly digest', () => runWeeklyDigest(telegram));

  // Identity pings — rotate through principles across 4 daily slots

  cron.schedule('0 10 * * *', async () => {
    try { await sendMessage(getNextPrinciple()); console.log('[identity] morning ping sent'); }
    catch (err) { console.error('[identity] morning ping failed:', err instanceof Error ? err.message : err); }
  }, { timezone: AUCKLAND });

  cron.schedule('45 13 * * 1-4', async () => {
    try { await sendMessage(getNextPrinciple()); console.log('[identity] pre-shift ping sent'); }
    catch (err) { console.error('[identity] pre-shift ping failed:', err instanceof Error ? err.message : err); }
  }, { timezone: AUCKLAND });

  cron.schedule('15 1 * * 2-5', async () => {
    try { await sendMessage(getNextPrinciple()); console.log('[identity] post-shift ping sent'); }
    catch (err) { console.error('[identity] post-shift ping failed:', err instanceof Error ? err.message : err); }
  }, { timezone: AUCKLAND });

  // Mid-afternoon PM check-in — 12:30pm daily
  cron.schedule('30 12 * * *', async () => {
    try {
      const [overdue, dueToday, active] = await Promise.all([
        getOverdueCommitments(),
        getDueTodayCommitments(),
        getActiveCommitments(),
      ]);

      const now = new Date().toLocaleString('en-NZ', {
        timeZone: AUCKLAND,
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
      });

      const prompt = `It is ${now} in Auckland.

Overdue commitments: ${JSON.stringify(overdue)}
Due today: ${JSON.stringify(dueToday)}
All active: ${JSON.stringify(active)}

Send Andrew a mid-afternoon PM check-in. Always send something — if nothing is overdue or due today, pick the most important active commitment and ask for a status update.

Rules:
- Max 3 lines
- Direct, specific — name the actual commitment
- If overdue: apply pressure, ask what happened
- If due today: check if on track
- If slip_count >= 2: reference the pattern, use benchmark framing
- If slip_count >= 3: identity challenge
- No filler, no preamble`;

      const anthropic = getAnthropicClient();
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        system: loadSystemPrompt(),
        messages: [{ role: 'user', content: prompt }],
      });
      const text = response.content.find(b => b.type === 'text');
      if (text && text.type === 'text') {
        await sendMessage(text.text);
        console.log('[pm] midday check-in sent');
      }
    } catch (err) {
      console.error('[pm] midday check-in failed:', err instanceof Error ? err.message : err);
    }
  }, { timezone: AUCKLAND });

  // Weekly review — Friday 6pm
  cron.schedule('0 18 * * 5', async () => {
    try {
      const [active, overdue] = await Promise.all([
        getActiveCommitments(),
        getOverdueCommitments(),
      ]);

      const prompt = `End of week review for Andrew.

Active commitments: ${JSON.stringify(active)}
Overdue: ${JSON.stringify(overdue)}

Write a weekly accountability review:
- What's on track
- What slipped and how many times
- Honest assessment of the week
- What needs to happen next week
- If multiple slips on same commitment: name the pattern
- Tone: direct coach, not cheerleader
- Max 8 lines`;

      const anthropic = getAnthropicClient();
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        system: loadSystemPrompt(),
        messages: [{ role: 'user', content: prompt }],
      });
      const text = response.content.find(b => b.type === 'text');
      if (text && text.type === 'text') {
        await sendMessage(text.text);
        console.log('[pm] weekly review sent');
      }
    } catch (err) {
      console.error('[pm] weekly review failed:', err instanceof Error ? err.message : err);
    }
  }, { timezone: AUCKLAND });

  console.log('[cron] 9 jobs registered (Pacific/Auckland)');
  console.log('[cron]   morning brief:        0 8 * * *');
  console.log('[cron]   evening (post-work):  0 1 * * 2-5');
  console.log('[cron]   evening (rest day):   0 22 * * 0,1');
  console.log('[cron]   weekly digest:        0 18 * * 0');
  console.log('[cron]   identity (morning):   0 10 * * *');
  console.log('[cron]   identity (pre-shift): 45 13 * * 1-4');
  console.log('[cron]   identity (post-shift):15 1 * * 2-5');
  console.log('[cron]   pm check-in:          30 12 * * *');
  console.log('[cron]   weekly review:        0 18 * * 5');
}
