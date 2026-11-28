import type { ConnectorSetup } from '@morrowbot/contracts';
import type { McpChannel } from './channel.ts';
import { openHttpChannel } from './http-channel.ts';
import type { McpTool } from './mcp-session.ts';
import type { Reach } from './secrets.ts';
import { openStdioChannel } from './stdio-channel.ts';

const record = (entries: readonly { readonly name: string; readonly value: string }[]): Record<string, string> =>
  Object.fromEntries(entries.map(({ name, value }) => [name, value]));

/** The URL a Composio connector reaches: its MCP server, pinned to one Composio user or connected account. */
export function composioUrl(setup: Extract<ConnectorSetup, { kind: 'composio' }>): string {
  const url = new URL(setup.serverUrl);
  switch (setup.account.kind) {
    case 'user':
      url.searchParams.set('user_id', setup.account.userId);
      break;
    case 'connected-account':
      url.searchParams.set('connected_account_id', setup.account.connectedAccountId);
      break;
  }
  return url.toString();
}

/** Opens the channel a connection reaches. `path` is the PATH local commands are found on. */
export function openChannel(reach: Reach, path: string): McpChannel {
  switch (reach.kind) {
    case 'stdio':
      return openStdioChannel({ command: reach.command, args: reach.args, env: record(reach.env), path });
    case 'http':
      return openHttpChannel({ url: reach.url, headers: record(reach.headers) });
  }
}

/**
 * The tools a connector gives agents. A Composio connector routes only its own toolkit's tools
 * (Composio names them `<TOOLKIT>_<ACTION>`), so one account's connector never carries another toolkit.
 */
export function offeredTools(setup: ConnectorSetup, tools: readonly McpTool[]): McpTool[] {
  switch (setup.kind) {
    case 'stdio':
    case 'http':
      return [...tools];
    case 'composio': {
      const prefix = `${setup.toolkit.toUpperCase().replaceAll('-', '_')}_`;
      return tools.filter(({ name }) => name.toUpperCase().startsWith(prefix));
    }
  }
}
