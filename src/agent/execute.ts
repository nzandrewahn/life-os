import { createClient } from '@supabase/supabase-js';
import { buildNote, readNote, writeNote, appendToNote } from '../integrations/obsidian';
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
    case 'read_notion_tasks':        return readNotionTasks(input);
    case 'write_notion_task':        return writeNotionTask(input);
    case 'read_notion_project':      return readNotionProject(input);
    case 'read_notion_programs':     return readNotionPrograms(input);
    case 'write_notion_inspiration': return writeNotionInspiration(input);
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
    case 'fetch_url':                return fetchUrl(input);
    case 'transcribe_audio':         return transcribeAudio(input);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function readNotionTasks(input: ToolInput) {
  const date = (input.date as string) ?? new Date().toISOString().split('T')[0];
  return {
    date,
    tasks: [
      {
        id: 'mock-task-1',
        title: 'Finalise logo directions',
        project: 'Abstracted Objects',
        effort: 'High',
        time_estimate: 2,
        priority: 'High',
        status: 'In progress',
        why: 'Gates the rest of the visual identity work',
        due: null,
      },
      {
        id: 'mock-task-2',
        title: 'Complete cloth shader study',
        project: 'Blender',
        effort: 'Medium',
        time_estimate: 1,
        priority: 'Normal',
        status: 'Not started',
        why: 'Building toward procedural material fluency',
        due: null,
      },
    ],
  };
}

async function writeNotionTask(input: ToolInput) {
  return {
    success: true,
    id: `mock-task-${Date.now()}`,
    title: input.title,
    project: input.project,
    message: `Task "${input.title}" created in ${input.project}`,
  };
}

async function readNotionProject(input: ToolInput) {
  return {
    name: input.project,
    phase: 'Phase 2 — Visual identity',
    status: 'Active',
    goal: 'Complete rebrand including logo, colour system, and type hierarchy',
    last_updated: new Date().toISOString().split('T')[0],
    open_tasks: 3,
  };
}

async function readNotionPrograms(input: ToolInput) {
  const date = (input.date as string) ?? new Date().toISOString().split('T')[0];
  return {
    date,
    training: {
      session: 'Upper body push',
      duration_minutes: 60,
      notes: '+ 20 min zone 2 cardio after',
    },
    sketching: {
      session: 'Timed figure sketches',
      exercises: '10 × 2min gestures',
      notes: 'Focus on line economy',
    },
  };
}

async function writeNotionInspiration(input: ToolInput) {
  return {
    success: true,
    id: `mock-inspiration-${Date.now()}`,
    url: input.url,
    title: input.title ?? 'Untitled',
    message: `Archived to Notion inspiration — ${input.category}`,
  };
}

async function readSupabaseHistory(input: ToolInput) {
  const days = (input.days as number) ?? 3;
  return {
    days_requested: days,
    messages: [
      {
        role: 'user',
        content: 'energy 7, got about 4 hours today',
        created_at: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        role: 'assistant',
        content: 'filed. focusing on logo directions and cloth shader today.',
        created_at: new Date(Date.now() - 86400000 + 1000).toISOString(),
      },
    ],
  };
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
  return {
    success: true,
    id: `mock-life-task-${Date.now()}`,
    title: input.title,
    category: input.category,
    message: `Life task "${input.title}" created`,
  };
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
