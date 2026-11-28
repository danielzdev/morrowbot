import type { ProviderError, TurnRequest } from '@morrowbot/plugin-sdk';
import type { CodexDaemon } from './daemon.ts';
import { threadPolicy, type ThreadPolicy } from './lockdown.ts';
import { resolve, type Resolution } from './route.ts';

export interface PreflightDeps {
  /** Why the CLI cannot run turns now (missing, outdated or untested), or null. */
  readonly checkCli: (cwd: string) => Promise<ProviderError | null>;
  /** Why this OS is not supported, or null. */
  readonly platformReason: string | null;
}

export type Checked =
  | {
      readonly kind: 'ok';
      readonly daemon: CodexDaemon;
      readonly accountKey: string;
      readonly routeKey: string;
      readonly subscription: boolean;
      readonly policy: ThreadPolicy;
    }
  | { readonly kind: 'refused'; readonly error: ProviderError };

/**
 * Checks a turn before any thread is opened: the access it asks for, the OS, the CLI, then the
 * account and route from one snapshot (signed out, then account changed, then route changed).
 */
export async function preflight(request: TurnRequest, deps: PreflightDeps, daemon: CodexDaemon | undefined): Promise<Checked> {
  if ((request.access !== 'read-only' && request.access !== 'full') || request.vendorSettings !== 'personal') {
    return refused({
      kind: 'access-not-supported',
      reason: `provider-openai runs read-only or full turns with your own Codex instructions, not ${request.access} with ${request.vendorSettings} settings.`,
    });
  }
  if (deps.platformReason !== null) return refused({ kind: 'access-not-supported', reason: deps.platformReason });
  const cli = await deps.checkCli(request.cwd);
  if (cli !== null) return refused(cli);
  if (daemon === undefined || !daemon.alive()) return refused({ kind: 'transient', retryAfterMs: null });
  const resolution = await resolve(daemon, request.cwd);
  const problem = mismatch(request, resolution);
  if (problem !== null) return refused(problem);
  if (resolution.kind !== 'resolved') return refused({ kind: 'transient', retryAfterMs: null });
  if (resolution.blocked !== null) return refused({ kind: 'access-not-supported', reason: resolution.blocked });
  return {
    kind: 'ok',
    daemon,
    accountKey: resolution.accountKey,
    routeKey: resolution.routeKey,
    subscription: resolution.route.kind === 'subscription',
    policy: threadPolicy(resolution.config, resolution.modelProvider, request.hostTools, request.access),
  };
}

/** Why a snapshot does not match the account and route the turn was admitted for, or null. */
export function mismatch(request: TurnRequest, resolution: Resolution): ProviderError | null {
  switch (resolution.kind) {
    case 'failed':
      return { kind: 'other', message: resolution.reason };
    case 'signed-out':
      return { kind: 'signed-out' };
    case 'resolved':
      break;
  }
  const { accountKey, routeKey } = resolution;
  if (accountKey !== request.expectedAccountKey) {
    if (request.expectedAccountKey === '') return { kind: 'route-changed' };
    if (accountKey !== '' || routeKey === request.expectedRouteKey) return { kind: 'account-changed' };
    return { kind: 'route-changed' };
  }
  if (routeKey !== request.expectedRouteKey) return { kind: 'route-changed' };
  if (resolution.blocked !== null) return { kind: 'access-not-supported', reason: resolution.blocked };
  return null;
}

function refused(error: ProviderError): Checked {
  return { kind: 'refused', error };
}
