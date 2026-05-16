import { Client } from '@notionhq/client';
import Anthropic from '@anthropic-ai/sdk';

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

interface InferredFields {
  priority: string;
  timeEstimate: number;
  energy: string;
  project: string | null;
}

async function inferTaskFields(title: string): Promise<InferredFields> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: `You are helping infer Notion task properties for Andrew. His projects are Lost Marbles Studio (kinetic activations, spec project is Token + Altar, dry run phase), Abstracted Objects (paused product drop brand), Blender (3D skill building), Sketching (30-day programme).

Given a task title, infer:
- priority: Critical / High / Normal / Low
- timeEstimate: number in hours (0.5, 1, 1.5, 2, 3, 4)
- energy: Low / Medium / High
- project: Lost Marbles / Abstracted Objects / Blender / Sketching / Personal / null if unclear

Respond with JSON only. No explanation.`,
    messages: [{ role: 'user', content: title }],
  });

  const block = response.content.find(b => b.type === 'text');
  if (!block || block.type !== 'text') return { priority: 'Normal', timeEstimate: 1, energy: 'Medium', project: null };

  try {
    return JSON.parse(block.text) as InferredFields;
  } catch {
    return { priority: 'Normal', timeEstimate: 1, energy: 'Medium', project: null };
  }
}

export interface WriteNotionTaskResult {
  id: string;
  title: string;
  project: string | null;
  priority: string;
  timeEstimate: number;
  energy: string;
}

export async function writeNotionTask(
  title: string,
  project?: string | null,
  priority?: string,
  timeEstimate?: number,
  energy?: string,
  why?: string,
): Promise<WriteNotionTaskResult> {
  const needsInference = !project || !priority || !energy || timeEstimate == null;
  let inferred: InferredFields | null = null;

  if (needsInference) {
    console.log('[notion] inferring fields for task:', title);
    inferred = await inferTaskFields(title);
    console.log('[notion] inferred:', inferred);
  }

  const finalProject = project ?? inferred?.project ?? null;
  const finalPriority = priority ?? inferred?.priority ?? 'Normal';
  const finalEnergy = energy ?? inferred?.energy ?? 'Medium';
  const finalTimeEstimate = timeEstimate ?? inferred?.timeEstimate ?? 1;

  const properties: Record<string, unknown> = {
    Name: { title: [{ text: { content: title } }] },
    Status: { status: { name: 'Not started' } },
    Priority: { select: { name: finalPriority } },
    'Time Estimate': { number: finalTimeEstimate },
    Energy: { select: { name: finalEnergy } },
  };
  if (finalProject) properties['Project'] = { select: { name: finalProject } };
  if (why) properties['Why'] = { rich_text: [{ text: { content: why } }] };

  const page = await notion.pages.create({
    parent: { database_id: process.env.NOTION_TASKS_DB_ID! },
    properties: properties as never,
  });

  return { id: page.id, title, project: finalProject, priority: finalPriority, timeEstimate: finalTimeEstimate, energy: finalEnergy };
}

export async function updateNotionTask(
  pageId: string,
  fields: {
    status?: string;
    priority?: string;
    energy?: string;
    timeEstimate?: number;
    project?: string;
    why?: string;
  },
): Promise<void> {
  console.log('[notion] updateNotionTask pageId:', pageId);
  console.log('[notion] priority provided:', fields.priority);
  console.log('[notion] energy provided:', fields.energy);
  console.log('[notion] timeEstimate provided:', fields.timeEstimate);
  console.log('[notion] project provided:', fields.project);
  console.log('[notion] why provided:', fields.why);

  const properties: Record<string, unknown> = {};
  if (fields.status)                properties['Status']        = { status: { name: fields.status } };
  if (fields.priority)              properties['Priority']      = { select: { name: fields.priority } };
  if (fields.energy)                properties['Energy']        = { select: { name: fields.energy } };
  if (fields.project)               properties['Project']       = { select: { name: fields.project } };
  if (fields.timeEstimate != null)  properties['Time Estimate'] = { number: fields.timeEstimate };
  if (fields.why)                   properties['Why']           = { rich_text: [{ text: { content: fields.why } }] };

  console.log('[notion] updateNotionTask props:', JSON.stringify(properties, null, 2));

  const response = await notion.pages.update({ page_id: pageId, properties: properties as never });
  console.log('[notion] update response:', JSON.stringify(response, null, 2));
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
