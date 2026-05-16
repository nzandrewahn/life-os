import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type Anthropic from '@anthropic-ai/sdk';

const NOTION_MCP_URL = 'https://mcp.notion.com/mcp';

let mcpClient: Client | null = null;
const toolNames = new Set<string>();

function getNotionToken(): string | undefined {
  // Support NOTION_API_KEY (primary) and NOTION_TOKEN (alias)
  return process.env.NOTION_API_KEY ?? process.env.NOTION_TOKEN;
}

async function getClient(): Promise<Client> {
  if (mcpClient) return mcpClient;

  const token = getNotionToken();
  if (!token) {
    throw new Error(
      '[notion-mcp] no auth token found — set NOTION_API_KEY (or NOTION_TOKEN) in env'
    );
  }

  console.log('[notion-mcp] connecting with NOTION_API_KEY (length:', token.length, ')');

  mcpClient = new Client({ name: 'caterina', version: '1.0.0' });

  const transport = new StreamableHTTPClientTransport(
    new URL(NOTION_MCP_URL),
    { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
  );

  try {
    await mcpClient.connect(transport);
  } catch (err) {
    mcpClient = null;
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[notion-mcp] connect failed: ${msg}`);
  }

  return mcpClient;
}

export async function loadNotionTools(): Promise<Anthropic.Tool[]> {
  const token = getNotionToken();
  if (!token) {
    console.error('[notion-mcp] NOTION_API_KEY is not set — Notion tools will not be available');
    return [];
  }

  let client: Client;
  try {
    client = await getClient();
  } catch (err) {
    console.error('[notion-mcp] connection error:', err instanceof Error ? err.message : err);
    return [];
  }

  let tools;
  try {
    ({ tools } = await client.listTools());
  } catch (err) {
    console.error('[notion-mcp] listTools failed:', err instanceof Error ? err.message : err);
    return [];
  }

  for (const t of tools) toolNames.add(t.name);
  console.log(`[notion-mcp] ready — ${tools.length} tools: ${tools.map(t => t.name).join(', ')}`);
  return tools.map(t => ({
    name: t.name,
    description: t.description ?? '',
    input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
  }));
}

export function isNotionTool(name: string): boolean {
  return toolNames.has(name);
}

export async function callNotionTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  let client: Client;
  try {
    client = await getClient();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[notion-mcp] cannot call ${name} — client unavailable: ${msg}`);
  }

  try {
    const result = await client.callTool({ name, arguments: args });
    if (Array.isArray(result.content)) {
      return result.content
        .map(block => ('text' in block ? (block as { text: string }).text : JSON.stringify(block)))
        .join('\n');
    }
    return JSON.stringify(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[notion-mcp] ${name} call failed: ${msg}`);
  }
}
