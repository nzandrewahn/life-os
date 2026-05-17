import axios, { AxiosError } from 'axios';

const API = 'https://api.github.com';
const token = () => process.env.GITHUB_TOKEN!;
const repo = () => process.env.GITHUB_OBSIDIAN_REPO!;
const branch = () => process.env.GITHUB_OBSIDIAN_BRANCH ?? 'main';

function headers() {
  return {
    Authorization: `Bearer ${token()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
    .slice(0, 80);
}

const FORBIDDEN_FOLDERS = ['2.Notes/Core', 'Archive', 'Templates'];
const LEARNING_SIGNALS = ['i learned', 'insight', 'realised', 'realized', 'key takeaway', 'from reading', 'from watching'];

export function resolveFolder(type: string, content: string): string {
  if (FORBIDDEN_FOLDERS.some(f => type.startsWith(f))) return '1.Inbox';
  if (type === 'daily') return '2.Notes/Daily';
  if (type === 'learning') return '2.Notes/Learnings';
  const lower = content.toLowerCase();
  if (LEARNING_SIGNALS.some(s => lower.includes(s))) return '2.Notes/Learnings';
  return '1.Inbox';
}

// Encode each path segment individually, preserve slashes
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function githubGet(path: string): Promise<{ content: string; sha: string }> {
  const url = `${API}/repos/${repo()}/contents/${encodePath(path)}`;
  const res = await axios.get(url, { headers: headers(), params: { ref: branch() } });
  return {
    content: Buffer.from(res.data.content, 'base64').toString('utf-8'),
    sha: res.data.sha,
  };
}

async function githubPut(path: string, content: string, message: string, sha?: string): Promise<void> {
  const url = `${API}/repos/${repo()}/contents/${encodePath(path)}`;
  const body: Record<string, unknown> = {
    message,
    content: Buffer.from(content).toString('base64'),
    branch: branch(),
  };
  if (sha) body.sha = sha;
  await axios.put(url, body, { headers: headers() });
}

export async function readNote(path: string): Promise<string> {
  const { content } = await githubGet(path);
  return content;
}

export async function writeNote(path: string, content: string): Promise<void> {
  const segments = path.split('/');
  const raw = segments.pop() ?? path;
  const ext = raw.endsWith('.md') ? '.md' : '';
  const base = ext ? raw.slice(0, -ext.length) : raw;
  const sanitized = sanitizeFilename(base) + ext;
  const filePath = [...segments, sanitized].join('/');
  console.log('[obsidian] writing to path:', filePath);

  try {
    await githubPut(filePath, content, `add: ${sanitized}`);
  } catch (err) {
    const status = (err as AxiosError).response?.status;
    if (status === 422) {
      const newFilename = sanitizeFilename(base) + `-${Date.now()}` + ext;
      const newPath = [...segments, newFilename].join('/');
      console.log('[obsidian] file exists, retrying as:', newPath);
      await githubPut(newPath, content, `add: ${newFilename}`);
    } else {
      throw err;
    }
  }
}

export async function appendToNote(path: string, addition: string): Promise<void> {
  try {
    const { content, sha } = await githubGet(path);
    const updated = content.trimEnd() + '\n\n' + addition;
    const name = path.split('/').pop() ?? path;
    await githubPut(path, updated, `update: ${name}`, sha);
  } catch (err) {
    const status = (err as AxiosError).response?.status;
    if (status === 404) {
      // Project note doesn't exist yet — create it
      await writeNote(path, addition);
    } else {
      throw err;
    }
  }
}

export interface NoteParams {
  title: string;
  content: string;
  type: string;
  tags?: string[];
}

export function buildNote(params: NoteParams): string {
  const date = new Date().toISOString().split('T')[0];
  const tags = (params.tags ?? []).join(', ');

  const frontmatter = [
    '---',
    `date: ${date}`,
    `type: ${params.type}`,
    `tags: [${tags}]`,
    `source: caterina`,
    '---',
  ].join('\n');

  return [frontmatter, '', params.content].join('\n');
}
