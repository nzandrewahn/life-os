import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

console.log('[notion] client methods:', typeof notion.databases?.query);

const TRAINING_PAGE_ID = process.env.NOTION_TRAINING_PAGE_ID ?? '';

const WARMUP = 'warm-up: rows of straight lines (horizontal, vertical, 45°, diagonal) then ellipses at different angles. 5 min.';

export interface NotionTask {
  id: string;
  name: string;
  status: string;
  priority: string;
  energy: string;
  project: string | null;
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
    status: (props['Status']?.status as { name?: string } | null)?.name ?? '',
    priority: getPropText(props['Priority'] ?? {}),
    energy: (props['Energy']?.select as { name?: string } | null)?.name ?? '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    project: (page as any).properties?.Project?.select?.name ?? null,
    timeEstimate: (props['Time Estimate']?.number as number | null) ?? null,
    why: getPropText(props['Why'] ?? {}),
    date: getPropText(props['Date'] ?? {}) || null,
  };
}

export async function readNotionTasks(): Promise<NotionTask[]> {
  const dbId = process.env.NOTION_TASKS_DB_ID!;
  console.log('[notion] querying tasks db:', dbId);

  const response = await notion.databases.query({
    database_id: dbId,
    sorts: [{ property: 'Priority', direction: 'ascending' }],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const active = response.results.filter(page => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (page as any).properties?.Status?.status?.name;
    return status !== 'Done';
  });

  console.log('[notion] tasks found:', active.length, 'active (of', response.results.length, 'total)');
  console.log('[notion] task names:', (active as Record<string, unknown>[]).map(
    p => ((p.properties as Record<string, Record<string, unknown>>)['Name']?.title as Array<{ plain_text: string }>)?.[0]?.plain_text
  ));

  return (active as Record<string, unknown>[]).map(mapTask);
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
    parent: { database_id: process.env.NOTION_TASKS_DB_ID! },
    properties: properties as never,
  });
  return { id: page.id };
}

export async function updateNotionTaskStatus(pageId: string, status: string): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Status: { select: { name: status } },
    },
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
  const sketchingDbId = process.env.NOTION_SKETCHING_DB_ID!;
  const response = await notion.databases.query({
    database_id: sketchingDbId,
    filter: {
      property: 'Done',
      checkbox: { equals: false },
    },
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
    },
  });
}

// ─── Training ─────────────────────────────────────────────────────────────────

export async function readTrainingToday(): Promise<string> {
  const today = new Intl.DateTimeFormat('en-NZ', {
    weekday: 'long',
    timeZone: 'Pacific/Auckland',
  }).format(new Date());

  console.log('[training] today is:', today);

  if (today === 'Friday' || today === 'Sunday') return 'rest day';

  const topLevel = await notion.blocks.children.list({
    block_id: process.env.NOTION_TRAINING_PAGE_ID!,
  });

  console.log('[training] top level blocks:', topLevel.results.length);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toDos: { text: string; checked: boolean }[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const block of topLevel.results as any[]) {
    if (block.type !== 'column_list') continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cols = await notion.blocks.children.list({ block_id: block.id });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const col of cols.results as any[]) {
      if (col.type !== 'column') continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items = await notion.blocks.children.list({ block_id: col.id });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const item of items.results as any[]) {
        if (item.type !== 'to_do') continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const text = (item.to_do.rich_text as any[]).map((t: any) => t.plain_text).join('');
        toDos.push({ text, checked: item.to_do.checked });
      }
    }
  }

  console.log('[training] to_do blocks found:', toDos.length);
  console.log('[training] checked count:', toDos.filter(t => t.checked).length);

  if (toDos.length === 0) return 'no sessions found — check notion connection';

  const lastCheckedIndex = toDos.map(t => t.checked).lastIndexOf(true);
  const weekIndex = lastCheckedIndex === -1 ? 0 : Math.floor(lastCheckedIndex / 7);

  console.log('[training] current week index:', weekIndex);

  const weekStart = weekIndex * 7;
  const weekTodos = toDos.slice(weekStart, weekStart + 7);

  console.log('[training] week todos:', weekTodos.map(t => t.text.substring(0, 50)));

  const todaySession = weekTodos.find(t => t.text.toLowerCase().includes(today.toLowerCase()));

  if (!todaySession) return 'rest day';

  return todaySession.text
    .replace(/\*\*/g, '')
    .replace(new RegExp(`^${today}:\\s*`, 'i'), '')
    .trim();
}

export async function markTrainingDone(blockId: string): Promise<void> {
  await notion.blocks.update({
    block_id: blockId,
    to_do: { checked: true },
  } as never);
}
