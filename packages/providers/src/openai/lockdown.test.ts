import type { HostTools } from '@morrowbot/plugin-sdk';
import { expect, it } from 'vitest';
import type { CodexDaemon } from './daemon.ts';
import { checkThread, policyKey, threadConfig, threadPolicy, turnSandboxPolicy } from './lockdown.ts';
import type { ThreadOpened } from './protocol.ts';

const NO_TOOLS: HostTools = { kind: 'none' };
const MCP_TOOLS: HostTools = { kind: 'mcp', url: 'http://127.0.0.1:9999/mcp', token: 'tok-1' };

function fakeDaemon(overrides: { readonly mcp?: unknown; readonly hooks?: unknown } = {}): CodexDaemon {
  return {
    generation: 1,
    codexHome: '/home/.codex',
    alive: () => true,
    call: (method, _params, schema) => {
      if (method === 'mcpServerStatus/list') return Promise.resolve({ kind: 'ok', value: schema.parse(overrides.mcp ?? { data: [], nextCursor: null }) });
      if (method === 'hooks/list') return Promise.resolve({ kind: 'ok', value: schema.parse(overrides.hooks ?? { data: [] }) });
      return Promise.resolve({ kind: 'error', code: -1, message: `unexpected ${method}` });
    },
    listen: () => () => undefined,
    lastTotal: () => undefined,
    loaded: new Map(),
    exited: new Promise(() => undefined),
    close: () => Promise.resolve(),
  };
}

function opened(overrides: Partial<ThreadOpened> = {}): ThreadOpened {
  return {
    thread: { id: 'thread-1' },
    model: 'gpt-test',
    modelProvider: 'openai',
    approvalPolicy: 'never',
    sandbox: { type: 'dangerFullAccess' },
    activePermissionProfile: null,
    ...overrides,
  };
}

it('builds distinct policies, sandbox policies, and keys for read-only vs full access', () => {
  const config = { mcp_servers: { user_mcp: {} } };
  const readOnly = threadPolicy(config, 'openai', MCP_TOOLS, 'read-only');
  const full = threadPolicy(config, 'openai', MCP_TOOLS, 'full');
  expect({
    readOnlySandbox: readOnly.sandbox,
    fullSandbox: full.sandbox,
    readOnlyTurnSandbox: turnSandboxPolicy(readOnly),
    fullTurnSandbox: turnSandboxPolicy(full),
    readOnlyLocksShell: readOnly.config['features.shell_tool'] === false && readOnly.config['mcp_servers.user_mcp.enabled'] === false,
    fullConfigKeys: Object.keys(threadConfig(full)),
    distinctKeys: policyKey(readOnly, '/work') !== policyKey(full, '/work'),
  }).toEqual({
    readOnlySandbox: 'read-only',
    fullSandbox: 'danger-full-access',
    readOnlyTurnSandbox: { type: 'readOnly', networkAccess: false },
    fullTurnSandbox: { type: 'dangerFullAccess' },
    readOnlyLocksShell: true,
    fullConfigKeys: ['mcp_servers.morrowbot'],
    distinctKeys: true,
  });
});

it('checkThread verifies dangerFullAccess and modelProvider for full turns, and refuses mismatched sandbox or provider', async () => {
  const full = threadPolicy({ mcp_servers: { user_mcp: {} } }, 'openai', NO_TOOLS, 'full');
  const daemon = fakeDaemon({ mcp: { data: [{ name: 'user_mcp', runtimeStatus: 'connected' }], nextCursor: null }, hooks: { data: [{ hooks: [{ event: 'PreToolUse' }] }] } });
  expect({
    ok: await checkThread(daemon, opened(), full),
    wrongSandbox: await checkThread(daemon, opened({ sandbox: { type: 'readOnly', networkAccess: false } }), full),
    wrongApproval: await checkThread(daemon, opened({ approvalPolicy: 'on-request' }), full),
    wrongProvider: await checkThread(daemon, opened({ modelProvider: 'other' }), full),
  }).toEqual({
    ok: null,
    wrongSandbox: 'Codex opened the thread with sandbox {"type":"readOnly","networkAccess":false}, approvals "never" and permission profile null, not full access without approvals.',
    wrongApproval: 'Codex opened the thread with sandbox {"type":"dangerFullAccess"}, approvals "on-request" and permission profile null, not full access without approvals.',
    wrongProvider: 'Codex opened the thread on the "other" model provider, not "openai".',
  });
});
