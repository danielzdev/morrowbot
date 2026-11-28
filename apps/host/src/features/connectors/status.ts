import type { ConnectorScope, ConnectorSetup, ConnectorSetupView, ConnectorStatus } from '@morrowbot/contracts';
import type { RuntimeState } from './runtime.ts';

/** The one status a connector shows: the first that applies, in the IA §3 order. */
export function connectorStatus(input: {
  readonly safeMode: boolean;
  readonly enabled: boolean;
  readonly connected: boolean;
  readonly scope: ConnectorScope;
  readonly runtime: RuntimeState;
  readonly toolCount: number;
}): ConnectorStatus {
  if (input.safeMode) return { kind: 'off_safe_mode' };
  if (!input.enabled) return { kind: 'turned_off' };
  const { runtime } = input;
  if (runtime.kind === 'failed' && runtime.failure === 'exited') return { kind: 'crashed', message: runtime.message };
  if (runtime.kind === 'failed' && runtime.failure === 'protocol') return { kind: 'unsupported', message: runtime.message };
  if (runtime.kind === 'failed' && runtime.failure === 'unreachable') return { kind: 'not_responding', message: runtime.message };
  if (runtime.kind === 'starting') return { kind: 'starting' };
  if (input.scope.scopeReviewRequired) return { kind: 'scope_needs_review' };
  if (runtime.kind === 'failed' && runtime.failure === 'auth') return { kind: 'reconnect_needed', message: runtime.message };
  if (!input.connected || runtime.kind !== 'ready') return { kind: 'not_connected' };
  return { kind: 'connected', toolCount: input.toolCount };
}

/** A setup as a window may see it: names of secrets, never their values. */
export function setupView(setup: ConnectorSetup): ConnectorSetupView {
  switch (setup.kind) {
    case 'stdio':
      return { kind: 'stdio', command: setup.command, args: [...setup.args], envNames: setup.env.map(({ name }) => name) };
    case 'http':
      return { kind: 'http', url: setup.url, headerNames: setup.headers.map(({ name }) => name) };
    case 'composio':
      return { kind: 'composio', toolkit: setup.toolkit, serverUrl: setup.serverUrl, account: setup.account };
  }
}
