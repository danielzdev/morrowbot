import type { UsageWindow } from '@morrowbot/plugin-sdk';
import type { CodexDaemon } from './daemon.ts';
import { GetAccountRateLimitsResponse } from './protocol.ts';
import { resolve, type Resolution } from './route.ts';

const READ_MS = 10_000;
const SESSION_MINS = 5 * 60;
const WEEK_MINS = 7 * 24 * 60;
const MONTH_MINS = 30 * 24 * 60;

/** Codex's main plan allowance as usage windows. Model-specific limits are left out. */
export function windowsOf(response: GetAccountRateLimitsResponse): UsageWindow[] {
  const snapshot = response.rateLimitsByLimitId?.codex ?? response.rateLimits;
  if (snapshot.limitId && snapshot.limitId !== 'codex') return [];
  const monthly = snapshot.planType === 'free' || snapshot.planType === 'go';
  const windows: UsageWindow[] = [];
  const positions = [
    ['primary', snapshot.primary, monthly ? MONTH_MINS : SESSION_MINS],
    ['secondary', snapshot.secondary, WEEK_MINS],
  ] as const;
  for (const [id, window, fallback] of positions) {
    if (!window || !Number.isFinite(window.usedPercent)) continue;
    const minutes = window.windowDurationMins ?? fallback;
    const kind = minutes >= MONTH_MINS ? 'monthly' : minutes >= WEEK_MINS ? 'weekly' : 'session';
    windows.push({
      id,
      kind,
      scope: { kind: 'account' },
      label: kind === 'session' ? 'Session' : kind === 'weekly' ? 'Weekly' : 'Monthly',
      usedPercent: percent(window.usedPercent),
      resetsAt: isoFromSeconds(window.resetsAt),
      windowMinutes: Number.isInteger(minutes) && minutes > 0 ? minutes : null,
    });
  }
  const individual = snapshot.individualLimit;
  if (individual && Number.isFinite(individual.remainingPercent)) {
    windows.push({
      id: 'individual',
      kind: 'monthly',
      scope: { kind: 'account' },
      label: 'Monthly credit limit',
      usedPercent: percent(100 - individual.remainingPercent),
      resetsAt: isoFromSeconds(individual.resetsAt),
      windowMinutes: null,
    });
  }
  return windows;
}

export type QuotaRead =
  | { readonly kind: 'available'; readonly accountKey: string; readonly observedAt: string; readonly windows: readonly UsageWindow[] }
  | { readonly kind: 'api-key-route' }
  | { readonly kind: 'signed-out' }
  /** The plan route, but Codex did not say which workspace or user. */
  | { readonly kind: 'unidentified' }
  /** No usable answer; `accountKey` is the plan account both checks saw, when they agreed on one. */
  | { readonly kind: 'failed'; readonly reason: string; readonly accountKey: string | null };

/**
 * Reads plan usage between two account-and-route checks of `cwd`. The windows count only when both
 * checks see the same known subscription account and route, and the usage response is for that
 * workspace (a non-null `accountId` that differs is refused).
 */
export async function readQuota(daemon: CodexDaemon, cwd: string): Promise<QuotaRead> {
  const before = await resolve(daemon, cwd);
  const route = subscription(before);
  if (route.kind !== 'ok') return route.read;
  const read = await daemon.call('account/rateLimits/read', { excludeResetCreditDetails: true }, GetAccountRateLimitsResponse, READ_MS);
  const after = await resolve(daemon, cwd);
  const again = subscription(after);
  if (again.kind !== 'ok') return again.read;
  if (again.accountKey !== route.accountKey || again.routeKey !== route.routeKey) {
    return { kind: 'failed', reason: 'The Codex account or route changed while usage was read.', accountKey: again.accountKey };
  }
  if (read.kind !== 'ok') return { kind: 'failed', reason: read.kind === 'error' ? read.message : read.reason, accountKey: route.accountKey };
  const accountId = read.value.accountId ?? null;
  if (accountId !== null && accountId !== route.workspaceId) {
    return { kind: 'failed', reason: 'Codex reported usage for a different workspace than the one signed in.', accountKey: route.accountKey };
  }
  return { kind: 'available', accountKey: route.accountKey, observedAt: new Date().toISOString(), windows: windowsOf(read.value) };
}

type Subscription =
  | { readonly kind: 'ok'; readonly accountKey: string; readonly routeKey: string; readonly workspaceId: string }
  | { readonly kind: 'not'; readonly read: QuotaRead };

function subscription(resolution: Resolution): Subscription {
  switch (resolution.kind) {
    case 'failed':
      return { kind: 'not', read: { kind: 'failed', reason: resolution.reason, accountKey: null } };
    case 'signed-out':
      return { kind: 'not', read: { kind: 'signed-out' } };
    case 'resolved':
      switch (resolution.route.kind) {
        case 'subscription':
          return { kind: 'ok', accountKey: resolution.accountKey, routeKey: resolution.routeKey, workspaceId: resolution.route.workspaceId };
        case 'unidentified':
          return { kind: 'not', read: { kind: 'unidentified' } };
        case 'stateless':
          return { kind: 'not', read: { kind: 'api-key-route' } };
      }
  }
}

function percent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function isoFromSeconds(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

