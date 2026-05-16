import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

const TASKS_DB_ID = process.env.NOTION_TASKS_DB_ID ?? '275237a5-f577-80fa-b074-000b071090b7';
const SKETCHING_DB_ID = process.env.NOTION_SKETCHING_DB_ID ?? '4cda0f06-fd18-488c-a65e-496e0a463ff7';
const TRAINING_PAGE_ID = process.env.NOTION_TRAINING_PAGE_ID ?? '';

const WARMUP = 'warm-up: rows of straight lines (horizontal, vertical, 45°, diagonal) then ellipses at different angles. 5 min.';

export interface NotionTask {
  id: string;
  name: string;
  status: string;
  priority: string;
  energy: string;
  project: string;
  timeEstimate: number | null;
  why: string;
  date: string | null;
}

function getPropText(prop: Record<string, unknown>): string {
  const type = prop.type as string;
  if (type === 'title') {
    const arr = prop.title as Array<{ plain_text: string }>;
    return arr.map(t => t.plain_text).join('');
  }
  if (type === 'rich_text') {
    const arr = prop.rich_text as Array<{ plain_text: string }>;
    return arr.map(t => t.plain_text).join('');
  }
  if (type === 'select') {
    const sel = prop.select as { name: string } | null;
    return sel?.name ?? '';
  }
  if (type === 'number') {
    const n = prop.number as number | null;
    return n != null ? String(n) : '';
  }
  if (type === 'date') {
    const d = prop.date as { start: string } | null;
    return d?.start ?? '';
  }
  return '';
}

function mapTask(page: Record<string, unknown>): NotionTask {
  const props = page.properties as Record<string, Record<string, unknown>>;
  return {
    id: page.id as string,
    name: getPropText(props['Name'] ?? {}),
    status: getPropText(props['Status'] ?? {}),
    priority: getPropText(props['Priority'] ?? {}),
    energy: getPropText(props['Energy'] ?? {}),
    project: getPropText(props['Project'] ?? {}),
    timeEstimate: props['Time Estimate']
      ? ((props['Time Estimate'].number as number | null) ?? null)
      : null,
    why: getPropText(props['Why'] ?? {}),
    date: getPropText(props['Date'] ?? {}) || null,
  };
}

export async function readNotionTasks(): Promise<NotionTask[]> {
  const response = await notion.dataSources.query({
    data_source_id: TASKS_DB_ID,
    filter: {
      property: 'Status',
      select: { does_not_equal: 'Done' },
    },
    sorts: [
      { property: 'Priority', direction: 'ascending' },
    ],
  });

  return (response.results as Record<string, unknown>[]).map(mapTask);
}

export async function writeNotionTask(
  title: string,
  project: string,
  priority: string,
  timeEstimate?: number,
  energy?: string,
  why?: string,
): Promise<{ id: string }> {
  const properties: Record<string, unknown> = {
    Name: { title: [{ text: { content: title } }] },
    Status: { select: { name: 'Not started' } },
    Priority: { select: { name: priority } },
    Project: { select: { name: project } },
  };
  if (timeEstimate != null) properties['Time Estimate'] = { number: timeEstimate };
  if (energy) properties['Energy'] = { select: { name: energy } };
  if (why) properties['Why'] = { rich_text: [{ text: { content: why } }] };

  const page = await notion.pages.create({
    parent: { type: 'data_source_id', data_source_id: TASKS_DB_ID } as never,
    properties: properties as never,
  });
  return { id: page.id };
}

export async function updateNotionTaskStatus(pageId: string, status: string): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Status: { select: { name: status } },
    } as never,
  });
}

// ─── Sketching ────────────────────────────────────────────────────────────────

export interface SketchingSession {
  day_number: number;
  title: string;
  week: string | null;
  page_id: string;
  session: string;
}

export async function readSketchingToday(): Promise<SketchingSession | { completed: true; message: string }> {
  const response = await notion.dataSources.query({
    data_source_id: SKETCHING_DB_ID,
    filter: {
      property: 'Done',
      select: { does_not_equal: '__YES__' },
    },
    sorts: [
      { property: 'Day Number', direction: 'ascending' },
    ],
    page_size: 1,
  });

  if (!response.results.length) {
    return { completed: true, message: 'all sketching sessions completed — programme finished!' };
  }

  const page = response.results[0] as Record<string, unknown>;
  const props = page.properties as Record<string, Record<string, unknown>>;
  const title = getPropText(props['Name'] ?? props['Title'] ?? {});
  const dayMatch = title.match(/^Day (\d+)/i);
  const dayNum = dayMatch ? parseInt(dayMatch[1], 10) : 0;
  const week = getPropText(props['Week'] ?? {}) || null;

  return {
    day_number: dayNum,
    title,
    week,
    page_id: page.id as string,
    session: `${WARMUP}\n\n${title}`,
  };
}

export async function markSketchingDone(pageId: string): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Done: { select: { name: '__YES__' } },
    } as never,
  });
}

// ─── Training ─────────────────────────────────────────────────────────────────

export interface TrainingDay {
  checked: boolean;
  day: string;
  session: string;
  rawLine: string;
}

export interface TrainingResult {
  rest_day: boolean;
  already_done?: boolean;
  week?: number;
  day?: string;
  session?: string;
  full_checkbox_line?: string;
  training_page_id?: string;
  mark_done_instruction?: string;
  error?: string;
}

function parseTrainingWeeks(content: string): Array<{ weekNum: number; days: TrainingDay[] }> {
  const weeks: Array<{ weekNum: number; days: TrainingDay[] }> = [];
  const columnRegex = /<column>([\s\S]*?)<\/column>/g;
  let colMatch;

  while ((colMatch = columnRegex.exec(content)) !== null) {
    const col = colMatch[1];
    const weekMatch = col.match(/\*\*Week (\d+)/);
    if (!weekMatch) continue;
    const weekNum = parseInt(weekMatch[1], 10);

    const cbRegex = /^([ \t]*- \[([ x])\] \*\*(\w+):\*\* .+)$/gm;
    const days: TrainingDay[] = [];
    let cb;

    while ((cb = cbRegex.exec(col)) !== null) {
      const rawLine = cb[1];
      const checked = cb[2] === 'x';
      const day = cb[3];
      const sessionMatch = rawLine.match(/\*\*\w+:\*\* (.+)$/);
      const session = sessionMatch ? sessionMatch[1].trim() : '';
      days.push({ checked, day, session, rawLine });
    }

    if (days.length > 0) weeks.push({ weekNum, days });
  }

  return weeks.sort((a, b) => a.weekNum - b.weekNum);
}

export async function readTrainingToday(): Promise<TrainingResult> {
  const pageId = TRAINING_PAGE_ID;
  if (!pageId) throw new Error('NOTION_TRAINING_PAGE_ID is not set');

  const page = await notion.pages.retrieveMarkdown({ page_id: pageId });
  const content = typeof page === 'string' ? page : JSON.stringify(page);

  const today = new Date().toLocaleDateString('en-NZ', {
    weekday: 'long',
    timeZone: 'Pacific/Auckland',
  });

  if (today === 'Friday') {
    return { rest_day: true, day: 'Friday', session: 'rest day' };
  }

  const weeks = parseTrainingWeeks(content);

  let currentWeekNum = 1;
  for (const week of weeks) {
    for (const day of week.days) {
      if (day.checked) currentWeekNum = week.weekNum;
    }
  }

  const currentWeek = weeks.find(w => w.weekNum === currentWeekNum);
  if (!currentWeek) {
    return { rest_day: false, error: `week ${currentWeekNum} not found in training plan` };
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
    mark_done_instruction: `call notion pages.update with page_id "${pageId}" to replace the checkbox line`,
  };
}

export async function markTrainingDone(pageId: string, rawLine: string): Promise<void> {
  const doneLine = rawLine.replace('- [ ]', '- [x]');
  await notion.pages.updateMarkdown({
    page_id: pageId,
    markdown: doneLine,
  } as never);
}
