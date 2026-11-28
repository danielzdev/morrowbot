import type { T3EventKind } from '@morrowbot/contracts';
import type { T3OutboxEntry, T3OutboxSchedule } from './ports.ts';

/** Attention and service trouble go out after 4 s of quiet; endings and stalls after 25 s; nothing waits past 45 s. */
export const URGENT_WINDOW_MS = 4000;
export const NORMAL_WINDOW_MS = 25_000;
export const MAX_COALESCE_MS = 45_000;
/** An unacknowledged batch is sent again (same ids) once this lease runs out. */
export const LEASE_MS = 10 * 60_000;
/** Batches go out only once the orchestrator has been idle this long. */
export const IDLE_MS = 5000;
/** The third counted deferral sends the event once more, marked `unverified`. */
export const MAX_DEFERRALS = 3;
/** A send the routine refused is retried after this, doubling up to the lease. */
export const SEND_RETRY_MS = 30_000;

const ORDER: Record<T3EventKind, number> = {
  needs_you: 0,
  failed: 1,
  t3_unreachable: 2,
  t3_degraded: 2,
  stalled: 3,
  watch_missing: 4,
  idle_unverified: 5,
  finished: 6,
};

/** Batch order: `needs_you` first, `finished` last. */
export function kindOrder(kind: T3EventKind): number {
  return ORDER[kind];
}

function urgent(kind: T3EventKind): boolean {
  switch (kind) {
    case 'needs_you':
    case 'failed':
    case 't3_unreachable':
    case 't3_degraded':
      return true;
    case 'finished':
    case 'stalled':
    case 'idle_unverified':
    case 'watch_missing':
      return false;
  }
}

/** How long a deferred event waits before it is tried again. */
export function retrySpacing(kind: T3EventKind): number {
  return kind === 'needs_you' || kind === 'failed' ? 60_000 : 10 * 60_000;
}

/**
 * When the ready events should go out: each new event restarts its class's quiet window (4 s urgent, 25 s
 * otherwise), the earlier class wins, and nothing waits more than 45 s after the oldest.
 */
export function flushAt(ready: readonly T3OutboxEntry[]): number {
  let oldest = Number.POSITIVE_INFINITY;
  let lastUrgent = Number.NEGATIVE_INFINITY;
  let lastNormal = Number.NEGATIVE_INFINITY;
  for (const entry of ready) {
    const at = Date.parse(entry.dueAt);
    oldest = Math.min(oldest, at);
    if (urgent(entry.event.kind)) lastUrgent = Math.max(lastUrgent, at);
    else lastNormal = Math.max(lastNormal, at);
  }
  const windows = [oldest + MAX_COALESCE_MS];
  if (Number.isFinite(lastUrgent)) windows.push(lastUrgent + URGENT_WINDOW_MS);
  if (Number.isFinite(lastNormal)) windows.push(lastNormal + NORMAL_WINDOW_MS);
  return Math.min(...windows);
}

/**
 * An event that could not be confirmed waits one retry spacing. The wait counts toward the cap only when it comes
 * at least one spacing after the last counted one, so a short T3 blip cannot use up the cap; the third goes out
 * `unverified`, ready at once.
 */
export function deferred(entry: T3OutboxEntry, now: number): T3OutboxSchedule {
  const spacing = retrySpacing(entry.event.kind);
  const counts = entry.countedDeferralAt === null || now - Date.parse(entry.countedDeferralAt) >= spacing;
  const deferrals = entry.deferrals + (counts ? 1 : 0);
  const countedDeferralAt = counts ? new Date(now).toISOString() : entry.countedDeferralAt;
  const unverified = deferrals >= MAX_DEFERRALS;
  return { dueAt: new Date(unverified ? now : now + spacing).toISOString(), deferrals, countedDeferralAt, unverified };
}
