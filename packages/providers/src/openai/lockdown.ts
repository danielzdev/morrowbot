import { HOST_TOOLS_SERVER } from '@morrowbot/contracts';
import type { HostTools } from '@morrowbot/plugin-sdk';
import type { CodexDaemon } from './daemon.ts';
import { HooksList, McpServerStatusList, type CodexConfig, type ThreadOpened } from './protocol.ts';

const CHECK_MS = 10_000;

/**
 * Every Codex 0.171 feature that is on by default and gives the model a way to run code, write files,
 * reach the desktop or a browser, spawn other agents or run hooks; `shell_snapshot` runs the login shell when a
 * thread opens; `image_generation` saves files outside the sandbox. The list is checked against `codex features list` whenever the tested range moves.
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
  'image_generation',
] as const;

export type CodexAccess = 'read-only' | 'full';

/**
 * What every MorrowBot thread runs with:
 * - `read-only`: Codex's read-only sandbox, no approvals, the expected model provider, and none of
 *   the user's command, MCP, app, plugin, agent or hook tools. Without its shell tool, read-only
 *   Codex runs no command (checked on 0.171). The one MCP server it runs is MorrowBot's own (`hostTools`).
 * - `full`: Codex's `danger-full-access` sandbox with no approvals and the expected model provider,
 *   keeping Codex's full shell and file access alongside MorrowBot's own MCP server.
 */
export type ThreadPolicy =
  | {
      readonly kind: 'read-only';
      readonly sandbox: 'read-only';
      readonly approvalPolicy: 'never';
      readonly modelProvider: string;
      readonly config: Readonly<Record<string, boolean>>;
      readonly hostTools: HostTools;
    }
  | {
      readonly kind: 'full';
      readonly sandbox: 'danger-full-access';
      readonly approvalPolicy: 'never';
      readonly modelProvider: string;
      readonly config: Readonly<Record<string, boolean>>;
      readonly hostTools: HostTools;
    };

export function threadPolicy(config: CodexConfig, modelProvider: string, hostTools: HostTools, access: CodexAccess = 'read-only'): ThreadPolicy {
  switch (access) {
    case 'read-only': {
      const servers = Object.keys(config.mcp_servers ?? {}).filter((name) => hostTools.kind === 'none' || name !== HOST_TOOLS_SERVER).sort();
      return {
        kind: 'read-only',
        sandbox: 'read-only',
        approvalPolicy: 'never',
        modelProvider,
        config: {
          ...Object.fromEntries(TOOL_FEATURES.map((name) => [`features.${name}`, false])),
          ...Object.fromEntries(servers.map((name) => [`mcp_servers.${name}.enabled`, false])),
        },
        hostTools,
      };
    }
    case 'full':
      return {
        kind: 'full',
        sandbox: 'danger-full-access',
        approvalPolicy: 'never',
        modelProvider,
        config: {},
        hostTools,
      };
  }
}

/**
 * The `config` overrides a thread opens with: the policy's switches, and MorrowBot's MCP server as a
 * whole table, so a server of the user's by the same name is replaced, not merged.
 */
export function threadConfig(policy: ThreadPolicy): Readonly<Record<string, unknown>> {
  const tools = policy.hostTools;
  switch (tools.kind) {
    case 'none':
      return policy.config;
    case 'mcp':
      return {
        ...policy.config,
        [`mcp_servers.${HOST_TOOLS_SERVER}`]: { url: tools.url, http_headers: { Authorization: `Bearer ${tools.token}` }, enabled: true, default_tools_approval_mode: 'approve' },
      };
  }
}

/**
 * Two threads loaded with the same key run in the same folder with the same provider, permissions and
 * tools. The key holds the turn's tool token, so a loaded thread is reopened with each turn's own.
 */
export function policyKey(policy: ThreadPolicy, cwd: string): string {
  return JSON.stringify([cwd, policy.kind, policy.sandbox, policy.approvalPolicy, policy.modelProvider, Object.entries(policy.config).sort(), policy.hostTools]);
}

/** The sandbox policy sent with read-only `turn/start`. */
export const READ_ONLY_SANDBOX = { type: 'readOnly', networkAccess: false } as const;

/** The sandbox policy sent with full-access `turn/start`. */
export const FULL_ACCESS_SANDBOX = { type: 'dangerFullAccess' } as const;

/** The `sandboxPolicy` sent with `turn/start` for `policy`. */
export function turnSandboxPolicy(policy: ThreadPolicy): typeof READ_ONLY_SANDBOX | typeof FULL_ACCESS_SANDBOX {
  switch (policy.kind) {
    case 'read-only':
      return READ_ONLY_SANDBOX;
    case 'full':
      return FULL_ACCESS_SANDBOX;
  }
}

/**
 * Checks the daemon's own report that a started or resumed thread matches `policy`:
 * - `read-only`: read-only sandbox with no network, no approvals, expected provider, no MCP server
 *   running but MorrowBot's, and no hook.
 * - `full`: `dangerFullAccess` sandbox, no approvals, expected provider.
 * Returns why not, or null.
 */
export async function checkThread(daemon: CodexDaemon, opened: ThreadOpened, policy: ThreadPolicy): Promise<string | null> {
  const { sandbox, approvalPolicy, activePermissionProfile } = opened;
  if (opened.modelProvider !== policy.modelProvider) {
    return `Codex opened the thread on the "${opened.modelProvider}" model provider, not "${policy.modelProvider}".`;
  }
  switch (policy.kind) {
    case 'full': {
      if (sandbox.type !== 'dangerFullAccess' || approvalPolicy !== 'never' || (activePermissionProfile ?? null) !== null) {
        return `Codex opened the thread with sandbox ${JSON.stringify(sandbox)}, approvals ${JSON.stringify(approvalPolicy)} and permission profile ${JSON.stringify(activePermissionProfile ?? null)}, not full access without approvals.`;
      }
      return null;
    }
    case 'read-only': {
      if (sandbox.type !== 'readOnly' || sandbox.networkAccess === true || approvalPolicy !== 'never' || (activePermissionProfile ?? null) !== null) {
        return `Codex opened the thread with sandbox ${JSON.stringify(sandbox)}, approvals ${JSON.stringify(approvalPolicy)} and permission profile ${JSON.stringify(activePermissionProfile ?? null)}, not read-only without approvals.`;
      }
      const threadId = opened.thread.id;
      const [servers, hooks] = await Promise.all([
        daemon.call('mcpServerStatus/list', { threadId, limit: 1000 }, McpServerStatusList, CHECK_MS),
        daemon.call('hooks/list', { threadId }, HooksList, CHECK_MS),
      ]);
      if (servers.kind !== 'ok' || servers.value.nextCursor) return 'Codex did not report which MCP servers the thread runs.';
      const ours = policy.hostTools.kind === 'mcp' ? HOST_TOOLS_SERVER : null;
      const running = servers.value.data.filter((server) => server.runtimeStatus !== 'disabled' && server.name !== ours).map((server) => server.name);
      if (running.length > 0) return `MorrowBot could not turn off these Codex MCP servers: ${running.join(', ')}.`;
      if (hooks.kind !== 'ok') return 'Codex did not report which hooks the thread runs.';
      if (hooks.value.data.some((entry) => entry.hooks.length > 0)) return 'MorrowBot could not turn off your Codex hooks.';
      return null;
    }
  }
}
