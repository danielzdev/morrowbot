import { HOST_TOOLS_SERVER, type HostTools } from '@morrowbot/contracts';
import type { AcpClient } from './client.ts';

/** An ACP `McpServer` for `session/new`: here only the HTTP kind. */
export interface AcpMcpServer {
  readonly type: 'http';
  readonly name: string;
  readonly url: string;
  readonly headers: readonly { readonly name: string; readonly value: string }[];
}

/**
 * The MCP servers a session opens with: Ori Bot's own for this turn, when the agent connects to
 * MCP over HTTP, and nothing else. An agent without HTTP support gets none, so the turn runs without them.
 */
export function hostMcpServers(client: Pick<AcpClient, 'mcpHttp'>, tools: HostTools): AcpMcpServer[] {
  switch (tools.kind) {
    case 'none':
      return [];
    case 'mcp':
      return client.mcpHttp ? [{ type: 'http', name: HOST_TOOLS_SERVER, url: tools.url, headers: [{ name: 'Authorization', value: `Bearer ${tools.token}` }] }] : [];
  }
}
