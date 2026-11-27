import type { CodexDaemon } from './daemon.ts';
import { HooksList, McpServerStatusList, type CodexConfig, type ThreadOpened } from './protocol.ts';

const CHECK_MS = 10_000;

/**
 * Every Codex 0.171 feature that is on by default and gives the model a way to run code, reach the
 * desktop or a browser, spawn other agents or run hooks; `shell_snapshot` runs the login shell when a
 * thread opens. The list is checked against `codex features list` whenever the tested range moves.
 */
const TOOL_FEATURES = [
  'shell_tool',
  'unified_exec',
  'shell_snapshot',
  'apps',
  'plugins',
  'hooks',
  'multi_agent',
  'multi_agent_v2',
  'browser_use',
  'browser_use_external',
  'computer_use',
  'in_app_browser',
  'code_mode_host',
  'skill_mcp_dependency_install',
] as const;

/**
 * What every MorrowBot thread runs with: Codex's read-only sandbox, no approvals, the expected model
 * provider, and none of the user's command, MCP, app, plugin, agent or hook tools. Without its shell
 * tool, read-only Codex runs no command (checked on 0.171: the model reports it has no shell, and
 * nothing is written).
 */
export interface ThreadPolicy {
  readonly sandbox: 'read-only';
  readonly approvalPolicy: 'never';
  readonly modelProvider: string;
  readonly config: Readonly<Record<string, boolean>>;
}

export function threadPolicy(config: CodexConfig, modelProvider: string): ThreadPolicy {
  const servers = Object.keys(config.mcp_servers ?? {}).sort();
  return {
    sandbox: 'read-only',
    approvalPolicy: 'never',
    modelProvider,
    config: {
      ...Object.fromEntries(TOOL_FEATURES.map((name) => [`features.${name}`, false])),
      ...Object.fromEntries(servers.map((name) => [`mcp_servers.${name}.enabled`, false])),
    },
  };
}

/** Two threads loaded with the same key run in the same folder with the same provider, permissions and tools. */
export function policyKey(policy: ThreadPolicy, cwd: string): string {
  return JSON.stringify([cwd, policy.sandbox, policy.approvalPolicy, policy.modelProvider, Object.entries(policy.config).sort()]);
}

/** The sandbox policy sent with every `turn/start`. */
export const READ_ONLY_SANDBOX = { type: 'readOnly', networkAccess: false } as const;

/**
 * Checks the daemon's own report that a started or resumed thread runs read-only with no approvals,
 * no MCP server running and no hook. Returns why not, or null.
 */
export async function checkThread(daemon: CodexDaemon, opened: ThreadOpened, policy: ThreadPolicy): Promise<string | null> {
  const { sandbox, approvalPolicy, activePermissionProfile } = opened;
  if (sandbox.type !== 'readOnly' || sandbox.networkAccess === true || approvalPolicy !== 'never' || (activePermissionProfile ?? null) !== null) {
    return `Codex opened the thread with sandbox ${JSON.stringify(sandbox)}, approvals ${JSON.stringify(approvalPolicy)} and permission profile ${JSON.stringify(activePermissionProfile ?? null)}, not read-only without approvals.`;
  }
  if (opened.modelProvider !== policy.modelProvider) {
    return `Codex opened the thread on the "${opened.modelProvider}" model provider, not "${policy.modelProvider}".`;
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
