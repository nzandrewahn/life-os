import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildNote, readNote, writeNote, appendToNote, resolveFolder } from '../integrations/obsidian';
import {
  readNotionTasks,
  writeNotionTask,
  updateNotionTask,
  deleteNotionTask,
  readSketchingToday,
  markSketchingDone,
  readTrainingToday,
  markTrainingDone,
  searchNotion,
  readNotionPage,
  type WriteNotionTaskResult,
  type NotionTask,
} from '../integrations/notion';
import { queryIndex, insertIndex } from '../memory/obsidian-index';
import { createReminder as iCloudCreateReminder } from '../integrations/reminders';
import {
  readCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from '../integrations/google-calendar';
import {
  readLifeTasks,
  writeLifeTask,
  completeLifeTask,
  updateLifeTask,
  deleteLifeTask,
} from '../integrations/google-tasks';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

type ToolInput = Record<string, unknown>;

export async function executeTool(name: string, input: ToolInput): Promise<unknown> {
  switch (name) {
    case 'read_notion_tasks':        return readNotionTasks();
    case 'search_notion':            return searchNotion(input.query as string);
    case 'read_notion_page':         return readNotionPage(input.page_id as string);
    case 'delete_notion_task':       return deleteNotionTask(input.page_id as string);
    case 'write_notion_task':        return execWriteNotionTask(input);
    case 'update_notion_task_status': return execUpdateNotionTask(input);
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
    case 'read_life_tasks':          return readLifeTasks();
    case 'write_life_task':          return execWriteLifeTask(input);
    case 'complete_life_task':       return execCompleteLifeTask(input);
    case 'update_life_task':         return updateLifeTask(input.task_id as string, { title: input.title as string | undefined, notes: input.notes as string | undefined, due: input.due as string | undefined });
    case 'delete_life_task':         return deleteLifeTask(input.task_id as string);
    case 'update_context':           return execUpdateContext(input);
    case 'fetch_url':                return fetchUrl(input);
    case 'transcribe_audio':         return transcribeAudio(input);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

type AlignmentVerdict = 'ALIGNED' | 'LATER' | 'DISTRACTION';

async function checkTaskAlignment(
  taskName: string,
  why: string | undefined,
  project: string | undefined,
  activeTasks: NotionTask[]
): Promise<{ verdict: AlignmentVerdict; context: string }> {
  const taskList = activeTasks
    .slice(0, 10)
    .map(t => `- ${t.name} (${t.project ?? 'untagged'})`)
    .join('\n') || 'none';

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    messages: [{
      role: 'user',
      content: `Andrew's current phase: building the base, clearing debt, stacking toward $1M NZD by 30. Active projects: Lost Marbles Studio (Itadaki Phase 1 active client, dry run phase), Abstracted Objects (paused), AI Assistant Build.

New task being added: "${taskName}"
Why: "${why || 'not specified'}"
Project: "${project || 'unspecified'}"

Current active tasks:
${taskList}

Assess in one sentence — is this:
A) aligned and timely — core to current phase
B) real but not now — valid later, not a current priority
C) distraction — not aligned with current trajectory

Reply with only: ALIGNED, LATER, or DISTRACTION
followed by one short sentence of context (max 12 words).`,
    }],
  });

  const text = response.content.find(b => b.type === 'text')?.text.trim() ?? '';
  console.log('[task] alignment check:', text);

  if (text.startsWith('DISTRACTION')) return { verdict: 'DISTRACTION', context: text.replace(/^DISTRACTION\s*/, '') };
  if (text.startsWith('LATER')) return { verdict: 'LATER', context: text.replace(/^LATER\s*/, '') };
  return { verdict: 'ALIGNED', context: '' };
}

async function execWriteNotionTask(input: ToolInput) {
  const taskName = input.title as string;
  const why = input.why as string | undefined;
  const project = input.project as string | undefined;

  const [result, activeTasks] = await Promise.all([
    writeNotionTask(
      taskName,
      project,
      input.priority as string | undefined,
      input.time_estimate as number | undefined,
      input.energy as string | undefined,
      why,
    ),
    readNotionTasks(),
  ]);

  const { verdict, context } = await checkTaskAlignment(taskName, why, project, activeTasks);

  const projectLabel = result.project ?? 'untagged';
  const time = result.timeEstimate ? `${result.timeEstimate}hr` : '?hr';
  let message = `added — ${result.title}\n→ ${projectLabel} · ${result.priority} · ${time} · ${result.energy} energy`;

  if (verdict === 'LATER') {
    message += `\n\nthough this looks like a 'later' task. worth parking and revisiting when ${context}`;
  } else if (verdict === 'DISTRACTION') {
    message += `\n\nheads up — this might be pulling focus. ${context} worth checking if it's actually needed now.`;
  }

  return { success: true, id: result.id, message: message + '\nanything to adjust?' };
}

async function execUpdateNotionTask(input: ToolInput) {
  console.log('[update] raw input:', JSON.stringify(input));
  console.log('[update] page_id:', input.page_id);
  console.log('[update] name:', input.name);
  console.log('[update] status:', input.status);
  console.log('[update] priority:', input.priority);
  console.log('[update] energy:', input.energy);
  console.log('[update] time_estimate:', input.time_estimate);
  console.log('[update] project:', input.project);
  console.log('[update] why:', input.why);
  await updateNotionTask(input.page_id as string, {
    name:         input.name          as string | undefined,
    status:       input.status        as string | undefined,
    priority:     input.priority      as string | undefined,
    energy:       input.energy        as string | undefined,
    timeEstimate: input.time_estimate as number | undefined,
    project:      input.project       as string | undefined,
    why:          input.why           as string | undefined,
  });
  const updated = ['name', 'status', 'priority', 'energy', 'time_estimate', 'project']
    .filter(k => input[k] != null)
    .map(k => `${k}: ${input[k]}`)
    .join(', ');
  return { success: true, message: `task updated — ${updated}` };
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
  const type = input.type as string;
  const title = input.title as string;
  const content = input.content as string;
  const filename = input.filename as string;

  const folder = resolveFolder(type, content);
  const path = `${folder}/${filename}.md`;

  const note = buildNote({
    title,
    content,
    type,
    tags: input.tags as string[] | undefined,
  });

  await writeNote(path, note);

  await insertIndex({
    title,
    path,
    folder,
    type,
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
  const entry = input.entry as string;
  const filePath = join(process.cwd(), 'context-updates.md');
  const existing = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
  writeFileSync(filePath, (existing + '\n' + entry).trim(), 'utf-8');
  console.log('[context] updated:', entry);
  return 'context updated';
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
  const result = await readTrainingToday();
  return {
    session: result.session,
    name: result.name,
    page_id: result.pageId,
  };
}

async function execMarkTrainingDone(input: ToolInput) {
  await markTrainingDone(input.page_id as string);
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

// ─── Google Tasks ──────────────────────────────────────────────────────────

async function execWriteLifeTask(input: ToolInput) {
  const id = await writeLifeTask(
    input.title as string,
    input.notes as string | undefined,
    input.due as string | undefined,
  );
  return { success: true, id, message: `life task added: ${input.title}` };
}

async function execCompleteLifeTask(input: ToolInput) {
  await completeLifeTask(input.task_id as string);
  return { success: true, message: 'life task completed' };
}
