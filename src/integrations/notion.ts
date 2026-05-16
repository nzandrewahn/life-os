import { Client } from '@notionhq/client';
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import Anthropic from '@anthropic-ai/sdk';

// Collection / data source ID for the Andrew Task Board
const DATA_SOURCE_ID = '275237a5-f577-80fa-b074-000b071090b7';

const PRIORITY_RANK: Record<string, number> = { Critical: 1, High: 2, Normal: 3, Low: 4 };
// High energy tasks sorted last — save for good days
const ENERGY_RANK: Record<string, number> = { Low: 1, Medium: 2, High: 3 };

function getNotion(): Client {
  const key = process.env.NOTION_API_KEY;
  if (!key) throw new Error('[notion] NOTION_API_KEY is not set');
  return new Client({ auth: key });
}

export interface NotionTask {
  id: string;
  url: string;
  name: string;
  status: string;
  priority: string | null;
  project: string | null;
  timeEstimate: number | null;
  energy: string | null;
  why: string | null;
  date: string | null;
  hasSubItems: boolean;
  isSubtask: boolean;
}

function mapTask(page: PageObjectResponse): NotionTask {
  const p = page.properties;
  const name = p.Name?.type === 'title' ? (p.Name.title?.[0]?.plain_text ?? '(untitled)') : '(untitled)';
  const status = p.Status?.type === 'status' ? (p.Status.status?.name ?? 'Not started') : 'Not started';
  const priority = p.Priority?.type === 'select' ? (p.Priority.select?.name ?? null) : null;
  const project = p.Project?.type === 'select' ? (p.Project.select?.name ?? null) : null;
  const timeEstimate = p['Time Estimate']?.type === 'number' ? (p['Time Estimate'].number ?? null) : null;
  const energy = p.Energy?.type === 'select' ? (p.Energy.select?.name ?? null) : null;
  const why = p.Why?.type === 'rich_text' ? (p.Why.rich_text?.[0]?.plain_text ?? null) : null;
  const date = p.Date?.type === 'date' ? (p.Date.date?.start ?? null) : null;
  const hasSubItems = p['Sub-item']?.type === 'relation' ? (p['Sub-item'].relation.length > 0) : false;
  const isSubtask = p['Parent item']?.type === 'relation' ? (p['Parent item'].relation.length > 0) : false;

  return { id: page.id, url: page.url, name, status, priority, project, timeEstimate, energy, why, date, hasSubItems, isSubtask };
}

export async function queryTasks(project?: string): Promise<NotionTask[]> {
  const notion = getNotion();

  const baseFilter = { property: 'Status', status: { does_not_equal: 'Done' } };
  const filter = project
    ? { and: [baseFilter, { property: 'Project', select: { equals: project } }] }
    : baseFilter;

  const response = await notion.dataSources.query({
    data_source_id: DATA_SOURCE_ID,
    filter,
    page_size: 100,
  });

  const tasks = response.results
    .filter((r): r is PageObjectResponse => r.object === 'page' && 'properties' in r)
    .map(mapTask);

  return tasks.sort((a, b) => {
    const pDiff = (PRIORITY_RANK[a.priority ?? ''] ?? 5) - (PRIORITY_RANK[b.priority ?? ''] ?? 5);
    if (pDiff !== 0) return pDiff;
    return (ENERGY_RANK[a.energy ?? ''] ?? 2) - (ENERGY_RANK[b.energy ?? ''] ?? 2);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildProperties(params: Record<string, any>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: Record<string, any> = {
    Name: { title: [{ text: { content: params.name } }] },
    Status: { status: { name: params.status ?? 'Not started' } },
  };
  if (params.priority) props.Priority = { select: { name: params.priority } };
  if (params.project) props.Project = { select: { name: params.project } };
  if (params.timeEstimate != null) props['Time Estimate'] = { number: params.timeEstimate };
  if (params.energy) props.Energy = { select: { name: params.energy } };
  if (params.why) props.Why = { rich_text: [{ text: { content: params.why } }] };
  if (params.date) props.Date = { date: { start: params.date } };
  if (params.parentPageId) props['Parent item'] = { relation: [{ id: params.parentPageId }] };
  return props;
}

export async function createTask(params: {
  name: string;
  priority?: string;
  project?: string;
  timeEstimate?: number;
  energy?: string;
  why?: string;
  date?: string;
  status?: string;
}): Promise<{ id: string; url: string }> {
  const notion = getNotion();
  const page = await notion.pages.create({
    parent: { data_source_id: DATA_SOURCE_ID, type: 'data_source_id' },
    properties: buildProperties(params),
  }) as PageObjectResponse;
  return { id: page.id, url: page.url };
}

export async function createSubtask(params: {
  name: string;
  parentPageId: string;
  priority?: string;
  project?: string;
  timeEstimate?: number;
  energy?: string;
  why?: string;
}): Promise<{ id: string; url: string }> {
  const notion = getNotion();
  const page = await notion.pages.create({
    parent: { data_source_id: DATA_SOURCE_ID, type: 'data_source_id' },
    properties: buildProperties(params),
  }) as PageObjectResponse;
  return { id: page.id, url: page.url };
}

export async function updateTaskStatus(pageId: string, status: string): Promise<void> {
  const notion = getNotion();
  await notion.pages.update({
    page_id: pageId,
    properties: { Status: { status: { name: status } } },
  });
}

export function pageIdFromUrl(url: string): string {
  // https://www.notion.so/TITLE-PAGEID32 or bare UUID
  const match = url.match(/([a-f0-9]{32})(?:[?#]|$)/);
  if (match) return match[1];
  const uuidMatch = url.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
  if (uuidMatch) return uuidMatch[1].replace(/-/g, '');
  throw new Error(`Cannot extract page ID from Notion URL: ${url}`);
}

export interface DecomposeResult {
  atomic: boolean;
  breakdown?: {
    phases: Array<{
      phase: number;
      tasks: Array<{
        name: string;
        time_estimate: number;
        priority: string;
        energy: string;
        why: string;
      }>;
    }>;
  };
}

const ATOMIC_VERBS = /^(review|write|send|call|update|fix|read|check|schedule|book|reply|prepare|draft|record|test|upload|export|share|edit|publish)\b/i;
const ABSTRACT_VERBS = /^(build|develop|create|launch|design|strategy|campaign|system|plan|set up|rebrand|overhaul|establish|implement|roll out)\b/i;

export async function decomposeTask(params: {
  name: string;
  timeEstimate?: number;
  why?: string;
}): Promise<DecomposeResult> {
  const { name, timeEstimate, why } = params;

  const isAtomic =
    timeEstimate !== undefined &&
    timeEstimate <= 2.5 &&
    ATOMIC_VERBS.test(name) &&
    !ABSTRACT_VERBS.test(name);

  if (isAtomic) return { atomic: true };

  const needsBreakdown =
    timeEstimate === undefined ||
    timeEstimate > 2.5 ||
    ABSTRACT_VERBS.test(name);

  if (!needsBreakdown) return { atomic: true };

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: `Break this task into specific atomic subtasks completable in one sitting (1-3 hours max). Each subtask needs: name, time_estimate (hours), priority (Critical/High/Normal/Low), energy (Low/Medium/High), why it matters. Sequence them — phase 1 tasks unlock phase 2. Context: Lost Marbles Studio is in dry run phase, Token + Altar is the spec project, first client outreach is imminent. Return JSON only:\n{"phases":[{"phase":1,"tasks":[{"name":"...","time_estimate":1.5,"priority":"High","energy":"Medium","why":"..."}]}]}`,
    messages: [{
      role: 'user',
      content: `Task: ${name}${timeEstimate != null ? `\nTime estimate: ${timeEstimate}h` : ''}${why ? `\nWhy: ${why}` : ''}`,
    }],
  });

  const text = response.content.find(b => b.type === 'text')?.text ?? '{}';
  try {
    const breakdown = JSON.parse(text);
    return { atomic: false, breakdown };
  } catch {
    return { atomic: false, breakdown: { phases: [] } };
  }
}
