import type { RegisterT3WatchRequest, T3EventKind, T3Watch, T3WatchState } from '@morrowbot/contracts';
import { z } from 'zod';
import type { Binding } from './identity.ts';
import { advance, afterReconnect, DEFAULT_STALL_MS, freshMemory, WatchMemory, type Emitted, type OpenState } from './machine.ts';
import { phaseOf, type ListedThread, type ProbeResult } from './observation.ts';
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
  register(request: RegisterT3WatchRequest, at: number): T3WatchRecord;
  /** A watch for a thread discovery found running, unless one already covers it. The caller runs the transaction. */
  discover(thread: ListedThread, at: number): T3WatchRecord | undefined;
  /** Applies one read to an open watch and queues its events, in one transaction. False when the watch is not open. */
  apply(watchId: string, result: ProbeResult, at: number): boolean;
  /** Settles the watches whose ending was acknowledged and takes those events off the queue, in one transaction. */
  acknowledge(eventIds: readonly string[], at: number): void;
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

  return {
    register: (request, at) => {
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
        memory: JSON.stringify(freshMemory(binding, stallAfterMs)),
      };
      supersede(request.threadId, record.watchId, at);
      store.watches.insert(record);
      return record;
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
    apply: (watchId, result, at) =>
      store.transaction(() => {
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
      }),
    acknowledge: (eventIds, at) => {
      store.transaction(() => {
        for (const eventId of eventIds) {
          const event = store.outbox.get(eventId);
          if (event === undefined || !store.outbox.acknowledge(eventId)) continue;
          if (event.scope !== 'watch' || !TERMINAL_EVENTS.has(event.kind)) continue;
          const watch = store.watches.get(event.watchId);
          if (watch?.state === event.kind && watch.settledAt === null) store.watches.update({ ...watch, settledAt: iso(at), updatedAt: iso(at) });
        }
      });
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
