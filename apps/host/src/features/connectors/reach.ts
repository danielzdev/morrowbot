import type { ConnectorSetup } from '@morrowbot/contracts';
import type { McpChannel } from './channel.ts';
import { openHttpChannel } from './http-channel.ts';
import type { McpTool } from './mcp-session.ts';
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

/** The setup's secret values (header and variable values, the Composio key). */
function secretValues(setup: ConnectorSetup): string[] {
  switch (setup.kind) {
    case 'stdio':
      return setup.env.map(({ value }) => value);
    case 'http':
      return setup.headers.map(({ value }) => value);
    case 'composio':
      return [setup.apiKey];
  }
}

/** Replaces each of the setup's secret values in `text`, so a server echoing one back cannot surface it in a status or a refusal. */
export function hideSecrets(setup: ConnectorSetup, text: string): string {
  return secretValues(setup)
    .filter((value) => value.length >= 4)
    .sort((a, b) => b.length - a.length)
    .reduce((hidden, value) => hidden.replaceAll(value, '[hidden]'), text);
}

/** Opens the channel a connector's setup describes. `path` is the PATH local commands are found on. */
export function openChannel(setup: ConnectorSetup, path: string): McpChannel {
  switch (setup.kind) {
    case 'stdio':
      return openStdioChannel({ command: setup.command, args: setup.args, env: record(setup.env), path });
    case 'http':
      return openHttpChannel({ url: setup.url, headers: record(setup.headers) });
    case 'composio':
      return openHttpChannel({ url: composioUrl(setup), headers: { 'x-api-key': setup.apiKey } });
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
