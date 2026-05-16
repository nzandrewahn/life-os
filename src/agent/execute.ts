import { createClient } from '@supabase/supabase-js';
import { appendFileSync } from 'fs';
import { join } from 'path';
import { buildNote, readNote, writeNote, appendToNote } from '../integrations/obsidian';
import { isNotionTool, callNotionTool } from '../integrations/notion-mcp';
import { queryIndex, insertIndex } from '../memory/obsidian-index';
import { createReminder as iCloudCreateReminder } from '../integrations/reminders';
import {
  readCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from '../integrations/google-calendar';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

type ToolInput = Record<string, unknown>;

export async function executeTool(name: string, input: ToolInput): Promise<unknown> {
  if (isNotionTool(name)) return callNotionTool(name, input);

  switch (name) {
    case 'read_supabase_history':    return readSupabaseHistory(input);
    case 'write_supabase_capture':   return writeSupabaseCapture(input);
    case 'write_supabase_life_task': return writeSupabaseLifeTask(input);
    case 'read_obsidian_index':      return execReadObsidianIndex(input);
    case 'write_obsidian_note':      return execWriteObsidianNote(input);
    case 'update_obsidian_note':     return execUpdateObsidianNote(input);
    case 'read_obsidian_note':       return execReadObsidianNote(input);
    case 'create_reminder':          return createReminder(input);
    case 'read_google_calendar':     return execReadGoogleCalendar(input);
    case 'create_calendar_event':    return execCreateCalendarEvent(input);
    case 'update_calendar_event':    return execUpdateCalendarEvent(input);
    case 'delete_calendar_event':    return execDeleteCalendarEvent(input);
    case 'read_training_today':      return execReadTrainingToday();
    case 'read_sketching_today':     return execReadSketchingToday();
    case 'update_context':           return execUpdateContext(input);
    case 'fetch_url':                return fetchUrl(input);
    case 'transcribe_audio':         return transcribeAudio(input);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function readSupabaseHistory(input: ToolInput) {
  const days = (input.days as number) ?? 3;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('messages')
    .select('role, content, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`messages query failed: ${error.message}`);
  return { days_requested: days, messages: data ?? [] };
}

async function writeSupabaseCapture(input: ToolInput) {
  const { error } = await supabase.from('captures').insert({
    raw_content: input.raw_content,
    content_type: input.content_type,
    summary: input.summary ?? null,
    classification: input.classification,
    project: input.project ?? null,
    routed_to: input.routed_to,
    reviewed: false,
  });
  if (error) throw new Error(`captures insert: ${error.message}`);
  return { success: true, message: 'capture logged' };
}

async function writeSupabaseLifeTask(input: ToolInput) {
  const { data, error } = await supabase.from('life_tasks').insert({
    title: input.title,
    category: input.category,
    time_estimate: input.time_estimate ?? null,
    priority: input.priority ?? 'normal',
    due_date: input.due_date ?? null,
    status: 'pending',
  }).select('id').single();
  if (error) throw new Error(`life_tasks insert failed: ${error.message}`);
  return { success: true, id: data.id, title: input.title, message: `life task "${input.title}" created` };
}

async function execReadObsidianIndex(input: ToolInput) {
  const results = await queryIndex({
    query: input.query as string,
    project: input.project as string | undefined,
    limit: input.limit as number | undefined,
  });
  return { query: input.query, count: results.length, results };
}

async function execWriteObsidianNote(input: ToolInput) {
  const folder = input.folder as string;
  const filename = input.filename as string;
  const path = `${folder}/${filename}.md`;

  const note = buildNote({
    title: input.title as string,
    content: input.content as string,
    type: input.type as string,
    project: input.project as string | undefined,
    source: (input.source as string | undefined) ?? 'telegram-capture',
    tags: input.tags as string[] | undefined,
    related: input.related as string[] | undefined,
  });

  await writeNote(path, note);

  await insertIndex({
    title: input.title as string,
    path,
    folder,
    type: input.type as string,
    project: input.project as string | undefined,
    tags: input.tags as string[] | undefined,
  });

  return { success: true, path, message: `note written to ${path}` };
}

async function execUpdateObsidianNote(input: ToolInput) {
  const path = input.path as string;
  const date = new Date().toISOString().split('T')[0];
  const section = `## ${date}\n\n${input.content as string}`;
  await appendToNote(path, section);
  return { success: true, path, message: `appended to ${path}` };
}

async function execReadObsidianNote(input: ToolInput) {
  const path = input.path as string;
  const content = await readNote(path);
  return { path, content };
}

async function createReminder(input: ToolInput) {
  const title = input.title as string;
  const dueDate = input.due_date ? new Date(input.due_date as string) : undefined;
  const notes = input.notes as string | undefined;

  await iCloudCreateReminder({ title, dueDate, notes });
  return { success: true, message: `reminder "${title}" created in Apple Reminders` };
}

async function execReadGoogleCalendar(input: ToolInput) {
  const days = (input.days as number | undefined) ?? 7;
  const events = await readCalendarEvents(days);
  return { days, count: events.length, events };
}

async function execCreateCalendarEvent(input: ToolInput) {
  const result = await createCalendarEvent({
    title: input.title as string,
    start: input.start as string,
    end: input.end as string,
    description: input.description as string | undefined,
    attendees: input.attendees as string[] | undefined,
  });
  return { success: true, ...result, message: `Event "${input.title}" created` };
}

async function execUpdateCalendarEvent(input: ToolInput) {
  const event = await updateCalendarEvent({
    eventId: input.event_id as string,
    title: input.title as string | undefined,
    start: input.start as string | undefined,
    end: input.end as string | undefined,
    description: input.description as string | undefined,
    attendees: input.attendees as string[] | undefined,
  });
  return { success: true, event, message: `Event "${event.title}" updated` };
}

async function execDeleteCalendarEvent(input: ToolInput) {
  if (!input.confirmed) {
    return { success: false, message: 'Deletion requires confirmed: true — ask the user to confirm first.' };
  }
  await deleteCalendarEvent(input.event_id as string);
  return { success: true, message: `Event ${input.event_id} deleted` };
}

async function execUpdateContext(input: ToolInput) {
  const fact = input.fact as string;
  const category = input.category as string;
  const timestamp = new Date().toISOString().split('T')[0];
  const entry = `[${timestamp}] [${category}] ${fact}\n`;
  const filePath = join(process.cwd(), 'context-updates.md');
  appendFileSync(filePath, entry, 'utf-8');
  return { success: true, message: `context updated: ${fact}` };
}

async function fetchUrl(input: ToolInput) {
  return {
    url: input.url,
    title: '[stub] Page title would be fetched here',
    description: '[stub] Meta description would be fetched here',
    summary: '[stub] Claude one-paragraph summary would go here',
    note: 'Would fetch real content in Phase 4',
  };
}

async function transcribeAudio(input: ToolInput) {
  return {
    file_id: input.file_id,
    transcript: '[stub] Whisper transcript would appear here',
    duration_seconds: 0,
    note: 'Would transcribe via OpenAI Whisper in Phase 4',
  };
}

// ─── Training & Sketching ──────────────────────────────────────────────────

interface TrainingDay {
  checked: boolean;
  day: string;
  session: string;
  rawLine: string;
}

interface TrainingWeek {
  weekNum: number;
  days: TrainingDay[];
}

function parseTrainingWeeks(content: string): TrainingWeek[] {
  const weeks: TrainingWeek[] = [];
  const columnRegex = /<column>([\s\S]*?)<\/column>/g;
  let colMatch;

  while ((colMatch = columnRegex.exec(content)) !== null) {
    const col = colMatch[1];
    const weekMatch = col.match(/\*\*Week (\d+)/);
    if (!weekMatch) continue;
    const weekNum = parseInt(weekMatch[1], 10);

    // Match lines like: [optional tabs]- [ ] **DayName:** session text
    const cbRegex = /^([ \t]*- \[([ x])\] \*\*(\w+):\*\* .+)$/gm;
    const days: TrainingDay[] = [];
    let cb;

    while ((cb = cbRegex.exec(col)) !== null) {
      const rawLine = cb[1];
      const checked = cb[2] === 'x';
      const day = cb[3];
      // session is everything after "**DayName:** "
      const sessionMatch = rawLine.match(/\*\*\w+:\*\* (.+)$/);
      const session = sessionMatch ? sessionMatch[1].trim() : '';
      days.push({ checked, day, session, rawLine });
    }

    if (days.length > 0) weeks.push({ weekNum, days });
  }

  return weeks.sort((a, b) => a.weekNum - b.weekNum);
}

function extractPageProperties(content: string): Record<string, unknown> | null {
  const match = content.match(/<properties>\n([\s\S]*?)\n<\/properties>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function execReadTrainingToday() {
  const pageId = process.env.NOTION_TRAINING_PAGE_ID;
  if (!pageId) throw new Error('NOTION_TRAINING_PAGE_ID is not set');

  const raw = await callNotionTool('notion-fetch', { id: pageId });
  const weeks = parseTrainingWeeks(raw);

  const today = new Date().toLocaleDateString('en-NZ', {
    weekday: 'long',
    timeZone: 'Pacific/Auckland',
  });

  if (today === 'Friday') {
    return { rest_day: true, day: 'Friday', session: 'rest day' };
  }

  // Determine current week from last checked session
  let currentWeekNum = 1;
  for (const week of weeks) {
    for (const day of week.days) {
      if (day.checked) currentWeekNum = week.weekNum;
    }
  }

  const currentWeek = weeks.find(w => w.weekNum === currentWeekNum);
  if (!currentWeek) {
    return { error: `week ${currentWeekNum} not found in training plan` };
  }

  const todayEntry = currentWeek.days.find(d => d.day.toLowerCase() === today.toLowerCase());

  if (!todayEntry || /^rest$/i.test(todayEntry.session)) {
    return { rest_day: true, day: today, week: currentWeekNum, session: 'rest day' };
  }

  return {
    rest_day: todayEntry.checked,
    already_done: todayEntry.checked,
    week: currentWeekNum,
    day: today,
    session: todayEntry.session,
    full_checkbox_line: todayEntry.rawLine,
    training_page_id: pageId,
    mark_done_instruction: `call notion-update-page with page_id "${pageId}", command "update_content", content_updates: [{ old_str: "${todayEntry.rawLine}", new_str: "${todayEntry.rawLine.replace('- [ ]', '- [x]')}" }]`,
  };
}

async function execReadSketchingToday() {
  const dbId = process.env.NOTION_SKETCHING_DB_ID;
  if (!dbId) throw new Error('NOTION_SKETCHING_DB_ID is not set');

  const WARMUP = 'warm-up: rows of straight lines (horizontal, vertical, 45°, diagonal) then ellipses at different angles. 5 min.';
  const dataSourceUrl = `collection://${dbId}`;

  // Search for all sessions — they're all titled "Day N — ..."
  const searchRaw = await callNotionTool('notion-search', {
    query: 'Day',
    data_source_url: dataSourceUrl,
    page_size: 25,
    max_highlight_length: 0,
  });

  let results: Array<{ id: string; title: string }> = [];
  try {
    const parsed = JSON.parse(searchRaw) as { results: Array<{ id: string; title: string }> };
    results = parsed.results ?? [];
  } catch {
    throw new Error(`could not parse sketching database search results: ${searchRaw.slice(0, 200)}`);
  }

  // Sort sessions by day number extracted from title ("Day N — ...")
  const sessions = results
    .map(r => {
      const m = r.title.match(/^Day (\d+)/i);
      return m ? { id: r.id, title: r.title, dayNum: parseInt(m[1], 10) } : null;
    })
    .filter((s): s is { id: string; title: string; dayNum: number } => s !== null)
    .sort((a, b) => a.dayNum - b.dayNum);

  // Fetch each in order until we find one that isn't done
  for (const session of sessions) {
    const pageRaw = await callNotionTool('notion-fetch', { id: session.id });
    const props = extractPageProperties(pageRaw);
    if (!props || props['Done'] === '__YES__') continue;

    return {
      day_number: session.dayNum,
      title: session.title,
      week: props['Week'] ?? null,
      page_id: session.id,
      session: `${WARMUP}\n\n${session.title}`,
    };
  }

  return { completed: true, message: 'all sketching sessions completed — programme finished!' };
}
