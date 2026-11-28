import type { RegisterT3WatchRequest, T3EventKind, T3Watch, T3WatchEvent, T3WatchState } from '@morrowbot/contracts';
import { z } from 'zod';
import type { Binding } from './identity.ts';
import { advance, afterReconnect, DEFAULT_STALL_MS, freshMemory, POLL_MS, RECOVERY_POLL_MS, WatchMemory, type Emitted, type OpenState } from './machine.ts';
import { phaseOf, type ListedThread, type Observation, type ProbeResult } from './observation.ts';
import type { T3WatchRecord, T3WatchStore } from './ports.ts';

const TERMINAL_EVENTS: ReadonlySet<T3EventKind> = new Set(['finished', 'failed', 'watch_missing', 'idle_unverified']);

export function openState(state: T3WatchState): OpenState | undefined {
  switch (state) {
    case 'watching':
    case 'running':
    case 'needs_you':
    case 'stalled':
      return state;
    case 'finished':
    case 'failed':
    case 'watch_missing':
    case 'idle_unverified':
    case 'superseded':
      return undefined;
  }
}

const StoredMemory = z
  .string()
  .transform((text, context): unknown => {
    try {
      const value: unknown = JSON.parse(text);
      return value;
    } catch {
      context.addIssue({ code: 'custom', message: 'Stored watch memory is malformed' });
      return z.NEVER;
    }
  })
  .pipe(WatchMemory);

/** Which run a registration follows (§3): an exact run id first; timestamps only for `start` or an exclusive thread. */
export function bindingOf(request: RegisterT3WatchRequest): Binding {
  if (request.runId !== undefined) return { kind: 'run', runId: request.runId };
  if (request.priorRunId === undefined) return { kind: 'first', launchedAt: Date.parse(request.launchedAt) };
  return request.exclusive ? { kind: 'after', priorRunId: request.priorRunId } : { kind: 'unbound' };
}

export function view(watch: T3WatchRecord): T3Watch {
  const { watchId, threadId, source, label, state, reason, runId, registeredAt, settledAt, updatedAt } = watch;
  return { watchId, threadId, source, label, state, reason, runId, registeredAt, settledAt, updatedAt };
}

export interface Registry {
  /** Records a registration, superseding the thread's unsettled watches. The caller runs the transaction. */
  register(request: RegisterT3WatchRequest, at: number, routineId?: string | null, chatThreadId?: string | null): T3WatchRecord;
  /** The routine bound to this watch when registered via agent tools, or null. */
  routineOf(watchId: string): string | null;
  /** The Ori Bot chat thread where this watch was created, or null. */
  chatThreadOf(watchId: string): string | null;
  /** A watch for a thread discovery found running, unless one already covers it. The caller runs the transaction. */
  discover(thread: ListedThread, at: number): T3WatchRecord | undefined;
  /** Applies one read to an open watch and queues its events, in one transaction. False when the watch is not open. */
  apply(watchId: string, result: ProbeResult, at: number): boolean;
  /** How long until the watch's next read (longer while it recovers from an `unverified` notice). */
  pollMs(watchId: string): number;
  /** An acknowledged event: off the queue, and its watch settled if the event ended it. The caller runs the transaction. */
  settle(event: T3WatchEvent, at: number): void;
  /**
   * An event the orchestrator found gone (two `NotFound` reads): off the queue with its transition key freed, its
   * watch unsettled and read again until the host sees `watch_missing` itself (or the same ending, if the thread is
   * back). The caller runs the transaction.
   */
  gone(event: T3WatchEvent, at: number): void;
  /**
   * An acknowledged `unverified` notice: off the queue with its transition key freed, and its watch read again (every
   * 60 s) until a complete read queues a verified event. The caller runs the transaction.
   */
  noticed(event: T3WatchEvent, at: number): void;
  /**
   * Checks a queued `finished` or `needs_you` against a fresh read. A superseded event is dropped (its key freed), and
   * the read is applied to its watch, reopened if the event had ended it. The caller runs the transaction.
   */
  revalidate(event: Extract<T3WatchEvent, { scope: 'watch' }>, result: ProbeResult, at: number): 'holds' | 'superseded' | 'unverifiable';
  /** Queues a service event once per fingerprint. */
  queueService(kind: 't3_unreachable' | 't3_degraded', fingerprint: string, reason: string, at: number): void;
  /** Restarts every open watch's stall clock (T3 came back). */
  reconnect(at: number): void;
  /** Each thread's current watch id, for `current-watches.json`. */
  current(): Map<string, string>;
}

export function createRegistry(store: T3WatchStore, newId: () => string): Registry {
  const iso = (at: number): string => new Date(at).toISOString();

  const supersede = (threadId: string, by: string, at: number): void => {
    for (const old of store.watches.unsettled(threadId)) {
      for (const event of store.outbox.undispatched(old.watchId)) {
        if (TERMINAL_EVENTS.has(event.kind)) store.outbox.drop(event.eventId);
      }
      store.watches.update({ ...old, state: 'superseded', reason: `replaced by ${by}`, updatedAt: iso(at) });
    }
  };

  const queue = (watch: T3WatchRecord, event: Emitted, at: number): void => {
    store.outbox.queue({ scope: 'watch', eventId: newId(), watchId: watch.watchId, threadId: watch.threadId, at: iso(at), ...event });
  };

  const applyNow = (watchId: string, result: ProbeResult, at: number): boolean => {
    const watch = store.watches.get(watchId);
    const state = watch === undefined ? undefined : openState(watch.state);
    if (watch === undefined || state === undefined) return false;
    const step = advance({ state, reason: watch.reason, runId: watch.runId, memory: StoredMemory.parse(watch.memory) }, result, at);
    const updated: T3WatchRecord = {
      ...watch,
      state: step.state,
      reason: step.reason,
      runId: step.runId,
      memory: JSON.stringify(step.memory),
      updatedAt: iso(at),
    };
    store.watches.update(updated);
    for (const event of step.events) queue(updated, event, at);
    return true;
  };

  /**
   * Puts a watch whose state is still the event's back to being read (an ended one becomes `running` again). A watch
   * that moved on since, was superseded or has settled is left alone: its newer transition already counts.
   */
  const reopen = (event: T3WatchEvent, at: number, recovery: WatchMemory['recovery']): void => {
    if (event.scope !== 'watch') return;
    const watch = store.watches.get(event.watchId);
    if (watch?.state !== event.kind || watch.settledAt !== null) return;
    const memory = StoredMemory.parse(watch.memory);
    const open = openState(watch.state) !== undefined;
    store.watches.update({
      ...watch,
      state: open ? watch.state : 'running',
      reason: open ? watch.reason : null,
      memory: JSON.stringify({ ...memory, candidate: null, notFoundReads: 0, recovery: recovery ?? memory.recovery }),
      updatedAt: iso(at),
    });
  };

  return {
    register: (request, at, routineId = null, chatThreadId = null) => {
      const binding = bindingOf(request);
      const stallAfterMs = request.stallAfterMin === undefined ? DEFAULT_STALL_MS : request.stallAfterMin * 60_000;
      const record: T3WatchRecord = {
        watchId: newId(),
        threadId: request.threadId,
        source: 'registered',
        label: request.label ?? null,
        state: 'watching',
        reason: null,
        runId: binding.kind === 'run' ? binding.runId : null,
        registeredAt: iso(at),
        settledAt: null,
        updatedAt: iso(at),
        memory: JSON.stringify(freshMemory(binding, stallAfterMs, routineId, chatThreadId)),
      };
      supersede(request.threadId, record.watchId, at);
      store.watches.insert(record);
      return record;
    },
    routineOf: (watchId) => {
      const watch = store.watches.get(watchId);
      return watch === undefined ? null : StoredMemory.parse(watch.memory).routineId;
    },
    chatThreadOf: (watchId) => {
      const watch = store.watches.get(watchId);
      return watch === undefined ? null : StoredMemory.parse(watch.memory).chatThreadId;
    },
    discover: (thread, at) => {
      if (phaseOf(thread.status) !== 'active' || thread.latestRunId === null) return undefined;
      const current = store.watches.current(thread.threadId);
      if (current !== undefined && (current.settledAt === null || current.runId === thread.latestRunId)) return undefined;
      const record: T3WatchRecord = {
        watchId: newId(),
        threadId: thread.threadId,
        source: 'discovered',
        label: null,
        state: 'watching',
        reason: null,
        runId: thread.latestRunId,
        registeredAt: iso(at),
        settledAt: null,
        updatedAt: iso(at),
        memory: JSON.stringify(freshMemory({ kind: 'run', runId: thread.latestRunId }, DEFAULT_STALL_MS)),
      };
      store.watches.insert(record);
      return record;
    },
    apply: (watchId, result, at) => store.transaction(() => applyNow(watchId, result, at)),
    pollMs: (watchId) => {
      const watch = store.watches.get(watchId);
      return watch !== undefined && StoredMemory.parse(watch.memory).recovery !== null ? RECOVERY_POLL_MS : POLL_MS;
    },
    settle: (event, at) => {
      if (!store.outbox.acknowledge(event.eventId)) return;
      if (event.scope !== 'watch' || !TERMINAL_EVENTS.has(event.kind)) return;
      const watch = store.watches.get(event.watchId);
      if (watch?.state === event.kind && watch.settledAt === null) store.watches.update({ ...watch, settledAt: iso(at), updatedAt: iso(at) });
    },
    gone: (event, at) => {
      store.outbox.acknowledge(event.eventId);
      store.outbox.release(event.eventId);
      reopen(event, at, null);
    },
    noticed: (event, at) => {
      store.outbox.acknowledge(event.eventId);
      store.outbox.release(event.eventId);
      if (event.kind === 'needs_you' || event.kind === 'finished') reopen(event, at, event.kind);
    },
    revalidate: (event, result, at) => {
      if (result.kind !== 'observation' || !complete(event, result.observation)) return 'unverifiable';
      const watch = store.watches.get(event.watchId);
      if (watch !== undefined && holds(event, watch, StoredMemory.parse(watch.memory), result.observation)) return 'holds';
      store.outbox.drop(event.eventId);
      reopen(event, at, null);
      applyNow(event.watchId, result, at);
      return 'superseded';
    },
    queueService: (kind, fingerprint, reason, at) => {
      store.transaction(() => store.outbox.queue({ scope: 'service', eventId: newId(), kind, fingerprint, reason, at: iso(at) }));
    },
    reconnect: (at) => {
      store.transaction(() => {
        for (const watch of store.watches.open()) {
          store.watches.update({ ...watch, memory: JSON.stringify(afterReconnect(StoredMemory.parse(watch.memory))), updatedAt: iso(at) });
        }
      });
    },
    current: () => new Map(store.watches.currentAll().map((watch) => [watch.threadId, watch.watchId])),
  };
}

/** Whether a read reports every signal the event's check needs; a missing one is never guessed. */
function complete(event: Extract<T3WatchEvent, { scope: 'watch' }>, observation: Observation): boolean {
  return observation.pendingRequests.kind === 'known' && (event.kind !== 'finished' || observation.background.kind === 'known');
}

/** Whether a fresh read still shows what the event reported: the same pending requests, or the same clean finish. */
function holds(event: Extract<T3WatchEvent, { scope: 'watch' }>, watch: T3WatchRecord, memory: WatchMemory, observation: Observation): boolean {
  const pending = observation.pendingRequests;
  switch (event.kind) {
    case 'needs_you': {
      const requests = memory.requests;
      return (
        watch.state === 'needs_you' &&
        requests?.fingerprint === event.fingerprint &&
        pending.kind === 'known' &&
        pending.value === requests.count &&
        observation.latestRunId === requests.runId
      );
    }
    case 'finished': {
      const background = observation.background;
      return (
        watch.state === 'finished' &&
        observation.latestRunId === event.runId &&
        phaseOf(observation.status) === 'completed' &&
        pending.kind === 'known' &&
        pending.value === 0 &&
        background.kind === 'known' &&
        background.value.taskIds.length === 0 &&
        !background.value.blockedOnThreadWait
      );
    }
    case 'failed':
    case 'stalled':
    case 'watch_missing':
    case 'idle_unverified':
      return true;
  }
}
