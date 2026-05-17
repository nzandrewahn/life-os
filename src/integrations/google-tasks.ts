import { google } from 'googleapis';

export interface LifeTask {
  id: string;
  title: string;
  notes?: string;
  due?: string;
}

function getAuth() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error('[google-tasks] GOOGLE_SERVICE_ACCOUNT_JSON is not set');
  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(json);
  } catch {
    throw new Error('[google-tasks] GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
  }
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/tasks'],
  });
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
  const res = await client.tasks.insert({
    tasklist: '@default',
    requestBody: {
      title,
      notes: notes ?? undefined,
      due: due ?? undefined,
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
