import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type Anthropic from '@anthropic-ai/sdk';

const NOTION_MCP_URL = 'https://mcp.notion.com/mcp';

let mcpClient: Client | null = null;
const toolNames = new Set<string>();

async function getClient(): Promise<Client> {
  if (mcpClient) return mcpClient;

  mcpClient = new Client({ name: 'caterina', version: '1.0.0' });

  const headers: Record<string, string> = {};
  if (process.env.NOTION_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.NOTION_TOKEN}`;
  }

  const transport = new StreamableHTTPClientTransport(
    new URL(NOTION_MCP_URL),
    { requestInit: { headers } },
  );

  await mcpClient.connect(transport);
  return mcpClient;
}

export async function loadNotionTools(): Promise<Anthropic.Tool[]> {
  const client = await getClient();
  const { tools } = await client.listTools();
  for (const t of tools) toolNames.add(t.name);
  console.log(`[notion-mcp] connected, ${tools.length} tools available`);
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
  const client = await getClient();
  const result = await client.callTool({ name, arguments: args });
  if (Array.isArray(result.content)) {
    return result.content
      .map(block => ('text' in block ? (block as { text: string }).text : JSON.stringify(block)))
      .join('\n');
  }
  return JSON.stringify(result);
}
