import { EntityId, type T3EventKind, type T3WatchState } from '@morrowbot/contracts';
import { z } from 'zod';
import { Binding, resolveIdentity, type Identity } from './identity.ts';
import { phaseOf, type Observation, type ProbeResult } from './observation.ts';

/** The target time between reads of one active watch. */
export const POLL_MS = 10_000;
/** `finished`, `idle_unverified` and `watch_missing (no_run)` each need two matching reads at least this far apart. */
export const CONFIRM_MS = 20_000;
export const DEFAULT_STALL_MS = 15 * 60_000;
/** How often a watch is read after an `unverified` notice about it was acknowledged. */
export const RECOVERY_POLL_MS = 60_000;
/** One read adds at most this much awake time, so a sleeping computer never looks like a stalled thread. */
const MAX_AWAKE_STEP_MS = 2 * POLL_MS;

export type OpenState = Extract<T3WatchState, 'watching' | 'running' | 'needs_you' | 'stalled'>;
export type WatchEventKind = Exclude<T3EventKind, 't3_unreachable' | 't3_degraded'>;

const Candidate = z.strictObject({
  kind: z.enum(['finished', 'idle_unverified', 'watch_missing']),
  reason: z.string().nullable(),
  /** The progress fingerprint both reads must share. */
  fingerprint: z.string(),
  since: z.number(),
});

/** What a watch remembers between reads (stored as JSON). */
export const WatchMemory = z.strictObject({
  binding: Binding,
  stallAfterMs: z.number().int().positive(),
  progress: z.string().nullable(),
  awakeNoProgressMs: z.number().nonnegative(),
  /** The progress fingerprint a `stalled` went out for; sent once per fingerprint. */
  stalledFor: z.string().nullable(),
  lastReadAt: z.number().nullable(),
  candidate: Candidate.nullable(),
  notFoundReads: z.number().int().nonnegative(),
  /** The pending requests a `needs_you` went out for; cleared once nothing is pending. */
  requests: z.strictObject({ count: z.number().int().positive(), runId: z.string().nullable(), fingerprint: z.string() }).nullable(),
  /**
   * Set once an `unverified` notice about this watch was acknowledged: its next complete read queues a verified
   * event, even for requests already reported. Cleared by any event, or by a read with nothing pending.
   */
  recovery: z.enum(['needs_you', 'finished']).nullable().default(null),
  /** Optional routine bound when the watch was registered via agent tools. */
  routineId: EntityId.nullable().default(null),
});
export type WatchMemory = z.infer<typeof WatchMemory>;

export function freshMemory(binding: Binding, stallAfterMs: number, routineId: string | null = null): WatchMemory {
  return {
    binding,
    stallAfterMs,
    progress: null,
    awakeNoProgressMs: 0,
    stalledFor: null,
    lastReadAt: null,
    candidate: null,
    notFoundReads: 0,
    requests: null,
    recovery: null,
    routineId,
  };
}

export interface MachineWatch {
  readonly state: OpenState;
  readonly reason: string | null;
  readonly runId: string | null;
  readonly memory: WatchMemory;
}

export interface Emitted {
  readonly kind: WatchEventKind;
  readonly runId: string | null;
  readonly fingerprint: string;
  readonly reason: string | null;
}

export interface Step {
  readonly state: T3WatchState;
  readonly reason: string | null;
  readonly runId: string | null;
  readonly memory: WatchMemory;
  readonly events: readonly Emitted[];
}

function stay(watch: MachineWatch, memory: WatchMemory): Step {
  return { state: watch.state, reason: watch.reason, runId: watch.runId, memory, events: [] };
}

function end(kind: Extract<WatchEventKind, 'finished' | 'failed' | 'watch_missing' | 'idle_unverified'>, runId: string | null, reason: string | null, memory: WatchMemory): Step {
  return { state: kind, reason, runId, memory, events: [{ kind, runId, fingerprint: reason ?? 'ok', reason }] };
}

/** Run, status, progress and helper states. Heartbeats such as `updatedAt` are left out on purpose. */
function progressOf(observation: Observation): string {
  const background = observation.background.kind === 'known' ? observation.background.value : null;
  return JSON.stringify([observation.latestRunId, observation.status, observation.itemCount, background?.taskIds ?? null, background?.blockedOnThreadWait ?? null]);
}

function busy(observation: Observation): boolean {
  if (observation.activeRunId !== null || phaseOf(observation.status) === 'active') return true;
  const { background } = observation;
  return background.kind === 'known' && (background.value.taskIds.length > 0 || background.value.blockedOnThreadWait);
}

/** What an idle thread would end the watch as, once a second read agrees. Never `finished` without every signal. */
function idleOutcome(identity: Identity, observation: Observation): Pick<z.infer<typeof Candidate>, 'kind' | 'reason'> {
  switch (identity.kind) {
    case 'ours': {
      if (phaseOf(observation.status) !== 'completed') return { kind: 'idle_unverified', reason: 'run outcome unknown' };
      const missing = [
        ...(observation.pendingRequests.kind === 'missing' ? ['pending requests'] : []),
        ...(observation.background.kind === 'missing' ? ['background work'] : []),
      ];
      return missing.length === 0 ? { kind: 'finished', reason: null } : { kind: 'idle_unverified', reason: `T3 did not report ${missing.join(' or ')}` };
    }
    case 'pending':
      return { kind: 'watch_missing', reason: 'no_run' };
    case 'newer':
      return { kind: 'idle_unverified', reason: 'a newer run replaced the watched one' };
    case 'ambiguous':
      return { kind: 'idle_unverified', reason: identity.reason };
  }
}

function observe(watch: MachineWatch, observation: Observation, at: number): Step {
  const before = watch.memory;
  const identity = resolveIdentity(before.binding, observation);
  const adopted = identity.kind === 'ours' && before.binding.kind !== 'run';
  const binding: Binding = adopted ? { kind: 'run', runId: identity.runId } : before.binding;
  const runId = identity.kind === 'ours' ? identity.runId : watch.runId;
  const progress = progressOf(observation);
  const step = before.lastReadAt === null ? 0 : Math.min(Math.max(at - before.lastReadAt, 0), MAX_AWAKE_STEP_MS);
  const awake = progress === before.progress ? before.awakeNoProgressMs + step : 0;
  const memory: WatchMemory = { ...before, binding, progress, awakeNoProgressMs: awake, lastReadAt: at, notFoundReads: 0 };

  if (identity.kind === 'ours' && phaseOf(observation.status) === 'unsuccessful') {
    return end('failed', runId, observation.error ?? observation.status, { ...memory, candidate: null });
  }

  const pending = observation.pendingRequests;
  if (pending.kind === 'known' && pending.value > 0) {
    const known = before.requests;
    if (watch.state === 'needs_you' && before.recovery === null && known?.count === pending.value && known.runId === observation.latestRunId) {
      return { state: 'needs_you', reason: null, runId, memory: { ...memory, candidate: null, awakeNoProgressMs: 0 }, events: [] };
    }
    const requests = {
      count: pending.value,
      runId: observation.latestRunId,
      fingerprint: `${String(pending.value)}@${observation.latestRunId ?? 'none'}#${String(observation.itemCount)}`,
    };
    const reason = `${String(pending.value)} pending request(s)`;
    return {
      state: 'needs_you',
      reason: null,
      runId,
      memory: { ...memory, requests, candidate: null, awakeNoProgressMs: 0 },
      events: [{ kind: 'needs_you', runId, fingerprint: requests.fingerprint, reason }],
    };
  }
  const settled: WatchMemory = { ...memory, requests: null };

  if (busy(observation)) {
    const open = { ...settled, candidate: null };
    if (awake < before.stallAfterMs) return { state: 'running', reason: null, runId, memory: open, events: [] };
    if (before.stalledFor === progress) return { state: 'stalled', reason: watch.reason, runId, memory: open, events: [] };
    const reason = `no progress for ${String(Math.round(awake / 60_000))} min`;
    return {
      state: 'stalled',
      reason,
      runId,
      memory: { ...open, stalledFor: progress },
      events: [{ kind: 'stalled', runId, fingerprint: progress, reason }],
    };
  }

  const outcome = idleOutcome(identity, observation);
  const prior = before.candidate;
  if (prior?.kind === outcome.kind && prior.reason === outcome.reason && prior.fingerprint === progress) {
    if (at - prior.since >= CONFIRM_MS) return end(outcome.kind, runId, outcome.reason, { ...settled, candidate: null });
    return { state: 'running', reason: null, runId, memory: settled, events: [] };
  }
  return { state: 'running', reason: null, runId, memory: { ...settled, candidate: { ...outcome, fingerprint: progress, since: at } }, events: [] };
}

/**
 * One read's effect on an open watch. Fail-closed: an unreadable read clears any half-confirmed ending and changes
 * nothing else; only two `NotFound` reads in a row make a thread missing; `finished` needs two matching complete reads
 * at least 20 s apart with explicit absence of pending requests and background work.
 */
export function advance(watch: MachineWatch, result: ProbeResult, at: number): Step {
  const memory = watch.memory;
  switch (result.kind) {
    case 'unreachable':
    case 'schema_mismatch':
      return stay(watch, { ...memory, candidate: null });
    case 'not_found': {
      const notFoundReads = memory.notFoundReads + 1;
      const next = { ...memory, candidate: null, notFoundReads };
      return notFoundReads >= 2 ? end('watch_missing', watch.runId, 'not_found', next) : stay(watch, next);
    }
    case 'observation':
      return recovered(observe(watch, result.observation, at), result.observation);
  }
}

function recovered(step: Step, observation: Observation): Step {
  const { recovery } = step.memory;
  if (recovery === null) return step;
  const resolved = recovery === 'needs_you' && observation.pendingRequests.kind === 'known' && observation.pendingRequests.value === 0;
  return step.events.length > 0 || resolved ? { ...step, memory: { ...step.memory, recovery: null } } : step;
}

/** After T3 comes back, stall time starts again from the next read. */
export function afterReconnect(memory: WatchMemory): WatchMemory {
  return { ...memory, awakeNoProgressMs: 0, lastReadAt: null };
}
