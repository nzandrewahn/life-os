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

  let taskTitle = title;
  if (due) {
    const hasTime = due.includes('T') && !due.endsWith('T00:00:00') && !due.endsWith('T00:00:00.000Z');
    if (hasTime) {
      const timeStr = new Date(due).toLocaleTimeString('en-NZ', {
        timeZone: 'Pacific/Auckland',
        hour: '2-digit',
        minute: '2-digit',
      });
      taskTitle = `${title} @ ${timeStr}`;
    }
  }

  const dueFormatted = due
    ? new Date(due).toISOString().split('T')[0] + 'T00:00:00.000Z'
    : undefined;

  const res = await client.tasks.insert({
    tasklist: '@default',
    requestBody: {
      title: taskTitle,
      notes: notes ?? undefined,
      ...(dueFormatted && { due: dueFormatted }),
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
  const res = await client.tasks.patch({
    tasklist: '@default',
    task: taskId,
    requestBody: {
      ...(params.title && { title: params.title }),
      ...(params.notes && { notes: params.notes }),
      ...(params.due && { due: params.due }),
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
