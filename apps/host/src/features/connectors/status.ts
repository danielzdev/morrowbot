import type { ConnectorScope, ConnectorSecretView, ConnectorSetup, ConnectorSetupView, ConnectorStatus } from '@morrowbot/contracts';
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

type Secret = { readonly kind: 'inline'; readonly name: string; readonly value: string } | { readonly kind: 'vault'; readonly name: string; readonly vaultId: string };

function secretView(secret: Secret): ConnectorSecretView {
  switch (secret.kind) {
    case 'inline':
      return { kind: 'inline', name: secret.name };
    case 'vault':
      return { kind: 'vault', name: secret.name, vaultId: secret.vaultId };
  }
}

/** A setup as a window may see it: names of secrets and the Vault items they come from, never their values. */
export function setupView(setup: ConnectorSetup): ConnectorSetupView {
  switch (setup.kind) {
    case 'stdio':
      return { kind: 'stdio', command: setup.command, args: [...setup.args], env: setup.env.map(secretView) };
    case 'http':
      return { kind: 'http', url: setup.url, headers: setup.headers.map(secretView) };
    case 'composio': {
      const { apiKey } = setup;
      return { kind: 'composio', toolkit: setup.toolkit, serverUrl: setup.serverUrl, apiKey: apiKey.kind === 'inline' ? { kind: 'inline' } : apiKey, account: setup.account };
    }
  }
}
