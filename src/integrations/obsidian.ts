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
  const name = path.split('/').pop() ?? path;
  await githubPut(path, content, `add: ${name}`);
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
  project?: string;
  source?: string;
  tags?: string[];
  related?: string[]; // note titles → become [[wikilinks]]
}

export function buildNote(params: NoteParams): string {
  const date = new Date().toISOString().split('T')[0];
  const source = params.source ?? 'telegram-capture';
  const related = (params.related ?? []).map(t => `[[${t}]]`).join(', ');
  const tags = (params.tags ?? []).join(', ');

  const frontmatter = [
    '---',
    `date: ${date}`,
    `type: ${params.type}`,
    `project: ${params.project ?? ''}`,
    `source: ${source}`,
    `related: ${related}`,
    `tags: [${tags}]`,
    '---',
  ].join('\n');

  return [
    frontmatter,
    '',
    `# ${params.title}`,
    '',
    params.content,
    '',
    '---',
    `*captured via ${source}, ${date}*`,
  ].join('\n');
}
