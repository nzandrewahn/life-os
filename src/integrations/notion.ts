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
      checkbox: { equals: false },
    } as never,
    sorts: [
      { property: 'Day Number', direction: 'ascending' },
    ],
    page_size: 1,
  });

  console.log('[notion] readSketchingToday raw response:', JSON.stringify(response).slice(0, 500));

  if (!response.results.length) {
    return { completed: true, message: 'all sketching sessions completed — programme finished!' };
  }

  const page = response.results[0] as Record<string, unknown>;
  const props = page.properties as Record<string, Record<string, unknown>>;
  const title = getPropText(props['Day'] ?? props['Name'] ?? props['Title'] ?? {});
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
      Done: { checkbox: true },
    } as never,
  });
}

// ─── Training ─────────────────────────────────────────────────────────────────

type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
};

async function fetchBlockChildren(blockId: string): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let cursor: string | undefined;
  do {
    const resp = await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    blocks.push(...(resp.results as NotionBlock[]));
    cursor = resp.has_more && resp.next_cursor ? resp.next_cursor : undefined;
  } while (cursor);
  return blocks;
}

function richText(block: NotionBlock): string {
  const data = block[block.type] as { rich_text?: Array<{ plain_text: string }> } | undefined;
  return data?.rich_text?.map(t => t.plain_text).join('') ?? '';
}

interface TrainingEntry {
  weekNum: number;
  day: string;
  session: string;
  checked: boolean;
  blockId: string;
}

async function collectTrainingEntries(pageId: string): Promise<TrainingEntry[]> {
  const entries: TrainingEntry[] = [];
  let currentWeek = 0;

  const topBlocks = await fetchBlockChildren(pageId);

  for (const block of topBlocks) {
    if (['heading_1', 'heading_2', 'heading_3'].includes(block.type)) {
      const text = richText(block);
      const m = text.match(/Week\s+(\d+)/i);
      if (m) currentWeek = parseInt(m[1], 10);
    }

    if (block.type === 'column_list') {
      const columns = await fetchBlockChildren(block.id);
      for (const col of columns) {
        if (col.type !== 'column') continue;
        const colBlocks = await fetchBlockChildren(col.id);
        for (const cb of colBlocks) {
          if (cb.type !== 'to_do') continue;
          const todo = cb.to_do as { checked: boolean; rich_text: Array<{ plain_text: string }> };
          const text = todo.rich_text.map(t => t.plain_text).join('');
          // expect "Monday: 5km easy" or "Monday: rest"
          const m = text.match(/^(\w+):\s*(.+)$/i);
          if (!m) continue;
          entries.push({
            weekNum: currentWeek,
            day: m[1],
            session: m[2].trim(),
            checked: todo.checked,
            blockId: cb.id,
          });
        }
      }
    }
  }

  return entries;
}

export interface TrainingResult {
  rest_day: boolean;
  already_done?: boolean;
  week?: number;
  day?: string;
  session?: string;
  to_do_block_id?: string;
  error?: string;
}

export async function readTrainingToday(): Promise<TrainingResult> {
  const pageId = TRAINING_PAGE_ID;
  if (!pageId) throw new Error('NOTION_TRAINING_PAGE_ID is not set');

  const today = new Date().toLocaleDateString('en-NZ', {
    weekday: 'long',
    timeZone: 'Pacific/Auckland',
  });

  if (today === 'Friday') {
    return { rest_day: true, day: 'Friday', session: 'rest day' };
  }

  const entries = await collectTrainingEntries(pageId);
  console.log(`[notion] readTrainingToday: ${entries.length} to_do blocks found`);

  // Current week = week of the last checked session (default week 1)
  let currentWeekNum = 1;
  for (const e of entries) {
    if (e.checked) currentWeekNum = e.weekNum;
  }

  const weekEntries = entries.filter(e => e.weekNum === currentWeekNum);
  if (!weekEntries.length) {
    return { rest_day: false, error: `no entries found for week ${currentWeekNum}` };
  }

  const todayEntry = weekEntries.find(e => e.day.toLowerCase() === today.toLowerCase());

  if (!todayEntry || /^rest$/i.test(todayEntry.session)) {
    return { rest_day: true, day: today, week: currentWeekNum, session: 'rest day' };
  }

  return {
    rest_day: todayEntry.checked,
    already_done: todayEntry.checked,
    week: currentWeekNum,
    day: today,
    session: todayEntry.session,
    to_do_block_id: todayEntry.blockId,
  };
}

export async function markTrainingDone(blockId: string): Promise<void> {
  await notion.blocks.update({
    block_id: blockId,
    to_do: { checked: true },
  } as never);
}
