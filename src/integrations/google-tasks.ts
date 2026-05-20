import { google } from 'googleapis';

export interface LifeTask {
  id: string;
  title: string;
  notes?: string;
  due?: string;
}

function getAuth() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_TASKS_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('[google-tasks] GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_TASKS_REFRESH_TOKEN is not set');
  }
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost');
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

function getClient() {
  return google.tasks({ version: 'v1', auth: getAuth() });
}

console.log('[google-tasks] integration ready');

function formatTaskTitle(title: string, due?: string): string {
  if (!due) return title;
  const dueDate = new Date(due);
  const hasTime =
    due.includes('T') &&
    !due.endsWith('T00:00:00.000Z') &&
    !(dueDate.getHours() === 0 && dueDate.getMinutes() === 0);
  if (!hasTime) return title;
  const timeStr = dueDate.toLocaleTimeString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${title} @ ${timeStr}`;
}

function formatDueDate(due?: string): string | undefined {
  if (!due) return undefined;
  return new Date(due).toISOString().split('T')[0] + 'T00:00:00.000Z';
}

export async function readLifeTasks(): Promise<LifeTask[]> {
  const client = getClient();
  const res = await client.tasks.list({
    tasklist: '@default',
    showCompleted: false,
    showDeleted: false,
    maxResults: 50,
  });

  return (res.data.items ?? []).map(t => ({
    id: t.id ?? '',
    title: t.title ?? '',
    notes: t.notes ?? undefined,
    due: t.due ?? undefined,
  }));
}

export async function writeLifeTask(title: string, notes?: string, due?: string): Promise<string> {
  const client = getClient();
  const res = await client.tasks.insert({
    tasklist: '@default',
    requestBody: {
      title: formatTaskTitle(title, due),
      notes: notes ?? undefined,
      ...(formatDueDate(due) && { due: formatDueDate(due) }),
    },
  });
  return res.data.id ?? '';
}

export async function completeLifeTask(taskId: string): Promise<void> {
  const client = getClient();
  await client.tasks.update({
    tasklist: '@default',
    task: taskId,
    requestBody: { id: taskId, status: 'completed' },
  });
}

export async function updateLifeTask(
  taskId: string,
  params: { title?: string; notes?: string; due?: string }
): Promise<LifeTask> {
  const client = getClient();

  let taskTitle = params.title;
  if (params.due && !params.title) {
    const existing = await client.tasks.get({ tasklist: '@default', task: taskId });
    taskTitle = existing.data.title ?? '';
  }

  const res = await client.tasks.patch({
    tasklist: '@default',
    task: taskId,
    requestBody: {
      ...(taskTitle !== undefined && { title: formatTaskTitle(taskTitle, params.due) }),
      ...(params.notes && { notes: params.notes }),
      ...(params.due && { due: formatDueDate(params.due) }),
    },
  });
  return {
    id: res.data.id ?? '',
    title: res.data.title ?? '',
    notes: res.data.notes ?? undefined,
    due: res.data.due ?? undefined,
  };
}

export async function deleteLifeTask(taskId: string): Promise<void> {
  const client = getClient();
  await client.tasks.delete({ tasklist: '@default', task: taskId });
}
