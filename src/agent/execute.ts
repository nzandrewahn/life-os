import { createClient } from '@supabase/supabase-js';
import { appendFileSync } from 'fs';
import { join } from 'path';
import { buildNote, readNote, writeNote, appendToNote } from '../integrations/obsidian';
import {
  readNotionTasks,
  writeNotionTask,
  updateNotionTaskStatus,
  readSketchingToday,
  markSketchingDone,
  readTrainingToday,
  markTrainingDone,
} from '../integrations/notion';
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
  switch (name) {
    case 'read_notion_tasks':        return readNotionTasks();
    case 'write_notion_task':        return execWriteNotionTask(input);
    case 'update_notion_task_status': return execUpdateNotionTaskStatus(input);
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
    case 'mark_training_done':       return execMarkTrainingDone(input);
    case 'read_sketching_today':     return execReadSketchingToday();
    case 'mark_sketching_done':      return execMarkSketchingDone(input);
    case 'update_context':           return execUpdateContext(input);
    case 'fetch_url':                return fetchUrl(input);
    case 'transcribe_audio':         return transcribeAudio(input);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function execWriteNotionTask(input: ToolInput) {
  const result = await writeNotionTask(
    input.title as string,
    input.project as string,
    input.priority as string,
    input.time_estimate as number | undefined,
    input.energy as string | undefined,
    input.why as string | undefined,
  );
  return { success: true, id: result.id, message: `task "${input.title}" created in Notion` };
}

async function execUpdateNotionTaskStatus(input: ToolInput) {
  await updateNotionTaskStatus(input.page_id as string, input.status as string);
  return { success: true, message: `task ${input.page_id} status updated to "${input.status}"` };
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

async function execReadTrainingToday() {
  console.log('[tool] read_training_today called');
  return readTrainingToday();
}

async function execMarkTrainingDone(input: ToolInput) {
  await markTrainingDone(input.block_id as string);
  return { success: true, message: 'training session marked done' };
}

async function execReadSketchingToday() {
  console.log('[tool] read_sketching_today called');
  return readSketchingToday();
}

async function execMarkSketchingDone(input: ToolInput) {
  await markSketchingDone(input.page_id as string);
  return { success: true, message: 'sketching session marked done' };
}
