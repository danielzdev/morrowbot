import type { CodexDaemon } from './daemon.ts';
import { HooksList, McpServerStatusList, type CodexConfig, type ThreadOpened } from './protocol.ts';

const CHECK_MS = 10_000;

/**
 * What every MorrowBot thread runs with: Codex's read-only sandbox, no approvals, and none of the
 * user's command, MCP, app, plugin or hook tools. Without its shell tool, read-only Codex runs no
 * command (checked on 0.171: the model reports it has no shell, and nothing is written).
 */
export interface ThreadPolicy {
  readonly sandbox: 'read-only';
  readonly approvalPolicy: 'never';
  readonly config: Readonly<Record<string, boolean>>;
}

export function threadPolicy(config: CodexConfig): ThreadPolicy {
  const servers = Object.keys(config.mcp_servers ?? {}).sort();
  return {
    sandbox: 'read-only',
    approvalPolicy: 'never',
    config: {
      'features.shell_tool': false,
      'features.unified_exec': false,
      'features.apps': false,
      'features.plugins': false,
      'features.codex_hooks': false,
      ...Object.fromEntries(servers.map((name) => [`mcp_servers.${name}.enabled`, false])),
    },
  };
}

/** Two threads loaded with the same key run with the same permissions and tools. */
export function policyKey(policy: ThreadPolicy): string {
  return JSON.stringify([policy.sandbox, policy.approvalPolicy, Object.entries(policy.config).sort()]);
}

/** The sandbox policy sent with every `turn/start`. */
export const READ_ONLY_SANDBOX = { type: 'readOnly', networkAccess: false } as const;

/**
 * Checks the daemon's own report that a started or resumed thread runs read-only with no approvals,
 * no MCP server running and no hook. Returns why not, or null.
 */
export async function checkThread(daemon: CodexDaemon, opened: ThreadOpened): Promise<string | null> {
  if (opened.sandbox.type !== 'readOnly' || opened.approvalPolicy !== 'never') {
    return `Codex opened the thread with sandbox "${opened.sandbox.type}" and approvals ${JSON.stringify(opened.approvalPolicy)}, not read-only without approvals.`;
  }
  const threadId = opened.thread.id;
  const [servers, hooks] = await Promise.all([
    daemon.call('mcpServerStatus/list', { threadId, limit: 1000 }, McpServerStatusList, CHECK_MS),
    daemon.call('hooks/list', { threadId }, HooksList, CHECK_MS),
  ]);
  if (servers.kind !== 'ok' || servers.value.nextCursor) return 'Codex did not report which MCP servers the thread runs.';
  const running = servers.value.data.filter((server) => server.runtimeStatus !== 'disabled').map((server) => server.name);
  if (running.length > 0) return `MorrowBot could not turn off these Codex MCP servers: ${running.join(', ')}.`;
  if (hooks.kind !== 'ok') return 'Codex did not report which hooks the thread runs.';
  if (hooks.value.data.some((entry) => entry.hooks.length > 0)) return 'MorrowBot could not turn off your Codex hooks.';
  return null;
}
