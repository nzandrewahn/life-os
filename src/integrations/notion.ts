import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

const TASKS_DB_ID = process.env.NOTION_TASKS_DB_ID ?? '275237a5f577800e8254f56b93e97a31';
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
    energy: (props['Energy']?.select as { name?: string } | null)?.name ?? '',
    project: getPropText(props['Project'] ?? {}),
    timeEstimate: (props['Time Estimate']?.number as number | null) ?? null,
    why: getPropText(props['Why'] ?? {}),
    date: getPropText(props['Date'] ?? {}) || null,
  };
}

export async function readNotionTasks(): Promise<NotionTask[]> {
  console.log('[notion] querying tasks db:', process.env.NOTION_TASKS_DB_ID);

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

  console.log('[notion] tasks found:', (response.results as Record<string, unknown>[]).map(
    p => ((p.properties as Record<string, Record<string, unknown>>)['Name']?.title as Array<{ plain_text: string }>)?.[0]?.plain_text
  ));

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

type ToDo = { text: string; checked: boolean };

export async function readTrainingToday(): Promise<string> {
  const topLevel = await notion.blocks.children.list({
    block_id: process.env.NOTION_TRAINING_PAGE_ID!,
  });

  const toDos: ToDo[] = [];

  for (const block of topLevel.results as Array<Record<string, unknown>>) {
    if (block.type !== 'column_list') continue;
    const columns = await notion.blocks.children.list({ block_id: block.id as string });
    for (const col of columns.results as Array<Record<string, unknown>>) {
      if (col.type !== 'column') continue;
      const items = await notion.blocks.children.list({ block_id: col.id as string });
      for (const item of items.results as Array<Record<string, unknown>>) {
        if (item.type !== 'to_do') continue;
        const todo = item.to_do as { checked: boolean; rich_text: Array<{ plain_text: string }> };
        const text = todo.rich_text.map(t => t.plain_text).join('');
        toDos.push({ text, checked: todo.checked });
      }
    }
  }

  console.log('[training] total to_do blocks found:', toDos.length);
  console.log('[training] checked:', toDos.filter(t => t.checked).length);

  const today = new Date().toLocaleDateString('en-NZ', {
    weekday: 'long',
    timeZone: 'Pacific/Auckland',
  });

  if (today === 'Friday' || today === 'Sunday') return 'rest day';

  const lastChecked = [...toDos].reverse().find(t => t.checked);
  const currentWeekIndex = lastChecked ? Math.floor(toDos.indexOf(lastChecked) / 7) : 0;

  const weekStart = currentWeekIndex * 7;
  const weekTodos = toDos.slice(weekStart, weekStart + 7);
  const todaySession = weekTodos.find(t => t.text.toLowerCase().includes(today.toLowerCase()));

  return todaySession?.text.replace(/^\*\*[A-Za-z]+:\*\*\s*/, '') ?? 'rest day';
}

export async function markTrainingDone(blockId: string): Promise<void> {
  await notion.blocks.update({
    block_id: blockId,
    to_do: { checked: true },
  } as never);
}
