import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { RegisterT3WatchRequest, T3WatchAck, type T3Watch, type T3WatchEvent } from '@morrowbot/contracts';
import type { z } from 'zod';
import { createDeliveryLane, type AckResult } from './delivery.ts';
import type { ListResult, ProbeResult } from './observation.ts';
import type { T3BatchRecord, T3DeliverySink, T3Probe, T3WatchClock, T3WatchStore } from './ports.ts';
import { createRegistry, view } from './registry.ts';
import { ACKS_FILE, readNewLines, REQUESTS_FILE, writeCurrentWatches } from './watch-files.ts';

export const TICK_MS = 1000;
export const DISCOVERY_MS = 30_000;
const MAX_IN_FLIGHT = 2;
const MAX_STARTS_PER_SECOND = 2;
const MAX_BACKOFF_MS = 60_000;
const OUTAGE_FAILURES = 3;
const OUTAGE_WINDOW_MS = 60_000;

export interface T3WatchServiceOptions {
  readonly store: T3WatchStore;
  readonly probe: T3Probe;
  readonly clock: T3WatchClock;
  /** The watch folder: `requests.jsonl` is read from it and `current-watches.json` written to it. */
  readonly dir: string;
  /** T3 projects (ids or paths) that discovery scans every 30 s; none turns discovery off. */
  readonly projects: readonly string[];
  /** The orchestrator's routine; null keeps delivery off (events wait in the outbox). */
  readonly sink: T3DeliverySink | null;
  readonly newId: () => string;
  readonly report: (error: unknown) => void;
  /** A problem with something an agent wrote, such as a malformed `requests.jsonl` line. */
  readonly warn: (message: string) => void;
}

export interface T3WatchService {
  register(request: RegisterT3WatchRequest, routineId?: string | null): T3Watch;
  list(): T3Watch[];
  /** The routine bound to `watchId` when registered via agent tools, or null. */
  routineOf(watchId: string): string | null;
  /** Stops and forgets a watch and its queued events. False when no such watch exists. */
  remove(watchId: string): boolean;
  /** Events waiting for an ack, oldest first. */
  pending(): T3WatchEvent[];
  /** The unacknowledged batch currently in flight, if any. */
  openBatch(): T3BatchRecord | undefined;
  /** Looks up any stored batch by id. */
  getBatch(batchId: string): T3BatchRecord | undefined;
  /** The orchestrator's ack for one batch (from the API; `acks.jsonl` lines take the same path). */
  ack(ack: T3WatchAck): AckResult;
  /** Reads new registrations, then starts the reads and discovery that are due, within the read limits. */
  tick(): void;
  /** Resolves once every read and file read started so far has been applied. */
  idle(): Promise<void>;
  close(): void;
}

interface Schedule {
  dueAt: number;
  failures: number;
}

/**
 * Watches T3 Code threads with one adaptive loop: about one `show` per open watch every 10 s, at most two in flight
 * and two started per second, none when nothing is open. Transitions and their outbox rows commit together.
 */
export function createT3WatchService(options: T3WatchServiceOptions): T3WatchService {
  const { store, probe, clock } = options;
  const registry = createRegistry(store, options.newId);
  const epoch = randomUUID();
  const schedules = new Map<string, Schedule>();
  const inFlight = new Set<string>();
  const starts: number[] = [];
  const work = new Set<Promise<void>>();
  const failures: number[] = [];
  const degraded = new Set<string>();
  const discoveryQueue: string[] = [];
  let discoveryDueAt = clock.now();
  const reading = new Set<string>();
  let checkCount = 0;
  let inOutage = false;
  let closed = false;

  const publish = (): void => {
    try {
      writeCurrentWatches(options.dir, registry.current());
    } catch (error) {
      options.report(error);
    }
  };

  const track = (promise: Promise<void>): void => {
    const tracked = promise.catch(options.report).finally(() => work.delete(tracked));
    work.add(tracked);
  };

  const slot = (now: number): boolean => {
    while (starts.length > 0 && (starts[0] ?? now) <= now - 1000) starts.shift();
    return inFlight.size < MAX_IN_FLIGHT && starts.length < MAX_STARTS_PER_SECOND;
  };

  const degrade = (fingerprint: string, reason: string, at: number): void => {
    if (degraded.has(fingerprint)) return;
    degraded.add(fingerprint);
    registry.queueService('t3_degraded', `${epoch}:${fingerprint}`, reason, at);
  };

  const health = (result: ProbeResult | ListResult, at: number): void => {
    switch (result.kind) {
      case 'unreachable': {
        failures.push(at);
        while (failures.length > 0 && (failures[0] ?? at) < at - OUTAGE_WINDOW_MS) failures.shift();
        if (!inOutage && failures.length >= OUTAGE_FAILURES) {
          inOutage = true;
          registry.queueService('t3_unreachable', `since:${new Date(at).toISOString()}`, result.detail, at);
        }
        return;
      }
      case 'schema_mismatch':
        degrade('schema_mismatch', `T3's output no longer matches: ${result.detail}`, at);
        return;
      case 'observation': {
        const { observation } = result;
        const missing = [
          ...(observation.pendingRequests.kind === 'missing' ? ['pending requests'] : []),
          ...(observation.background.kind === 'missing' ? ['background work'] : []),
        ];
        if (missing.length > 0) degrade(`missing:${missing.join(',')}`, `T3 does not report ${missing.join(' or ')}`, at);
        break;
      }
      case 'not_found':
      case 'threads':
        break;
    }
    failures.length = 0;
    if (!inOutage) return;
    inOutage = false;
    registry.reconnect(at);
    for (const schedule of schedules.values()) schedule.dueAt = Math.min(schedule.dueAt, at);
  };

  const read = (watchId: string, threadId: string): void => {
    inFlight.add(watchId);
    starts.push(clock.now());
    track(
      probe
        .inspect(threadId)
        .then((result) => {
          if (closed) return;
          const at = clock.now();
          health(result, at);
          registry.apply(watchId, result, at);
          const schedule = schedules.get(watchId);
          if (schedule === undefined) return;
          const ok = result.kind === 'observation' || result.kind === 'not_found';
          schedule.failures = ok ? 0 : schedule.failures + 1;
          schedule.dueAt = at + Math.min(registry.pollMs(watchId) * 2 ** schedule.failures, MAX_BACKOFF_MS);
        })
        .finally(() => inFlight.delete(watchId)),
    );
  };

  const discover = (project: string): void => {
    const key = `discovery:${project}`;
    inFlight.add(key);
    starts.push(clock.now());
    track(
      probe
        .list(project)
        .then((result) => {
          if (closed) return;
          const at = clock.now();
          health(result, at);
          if (result.kind !== 'threads') return;
          const found = store.transaction(() => result.threads.map((thread) => registry.discover(thread, at)).filter((watch) => watch !== undefined));
          if (found.length > 0) publish();
        })
        .finally(() => inFlight.delete(key)),
    );
  };

  /** A fresh read for the delivery lane, within the same read limits; undefined when no slot is free. */
  const freshRead = (threadId: string): Promise<ProbeResult> | undefined => {
    const now = clock.now();
    if (!slot(now)) return undefined;
    const key = `check:${String((checkCount += 1))}`;
    inFlight.add(key);
    starts.push(now);
    return probe
      .inspect(threadId)
      .then((result) => {
        if (!closed) health(result, clock.now());
        return result;
      })
      .finally(() => inFlight.delete(key));
  };

  const lane = createDeliveryLane({ store, registry, sink: options.sink, clock, dir: options.dir, newId: options.newId, read: freshRead, track, warn: options.warn });

  /** Takes the complete new lines of a shared file in the watch folder, one valid line at a time. */
  const intake = <T>(file: string, schema: z.ZodType<T>, take: (values: readonly T[], at: number) => void, after: (values: readonly T[]) => void): void => {
    if (reading.has(file)) return;
    reading.add(file);
    track(
      readNewLines(path.join(options.dir, file), store.outbox.cursor(file))
        .then((found) => {
          if (closed || found.kind === 'missing') return;
          const values = found.lines.flatMap((line) => {
            const parsed = schema.safeParse(parseLine(line));
            if (parsed.success) return [parsed.data];
            options.warn(`Skipped a malformed ${file} line: ${line.slice(0, 200)}`);
            return [];
          });
          const at = clock.now();
          store.transaction(() => {
            take(values, at);
            store.outbox.setCursor(file, found.cursor);
          });
          after(values);
        })
        .finally(() => {
          reading.delete(file);
        }),
    );
  };

  const readRequests = (): void => {
    intake(
      REQUESTS_FILE,
      RegisterT3WatchRequest,
      (requests, at) => {
        for (const request of requests) registry.register(request, at);
      },
      (requests) => {
        if (requests.length > 0) publish();
      },
    );
  };

  const readAcks = (): void => {
    intake(
      ACKS_FILE,
      T3WatchAck,
      (acks) => {
        for (const ack of acks) {
          if (lane.ack(ack).kind === 'unknown_batch') options.warn(`Skipped an ack for unknown batch ${ack.batchId}`);
        }
      },
      () => undefined,
    );
  };

  const tick = (): void => {
    if (closed) return;
    const now = clock.now();
    readRequests();
    readAcks();
    lane.tick();
    if (options.projects.length > 0 && now >= discoveryDueAt && discoveryQueue.length === 0) {
      discoveryQueue.push(...options.projects);
      discoveryDueAt = now + DISCOVERY_MS;
    }
    while (discoveryQueue.length > 0 && slot(now)) {
      const project = discoveryQueue.shift();
      if (project !== undefined) discover(project);
    }
    const open = store.watches.open();
    const ids = new Set(open.map((watch) => watch.watchId));
    for (const id of schedules.keys()) if (!ids.has(id)) schedules.delete(id);
    const due = open
      .map((watch) => {
        const schedule = schedules.get(watch.watchId) ?? { dueAt: now, failures: 0 };
        schedules.set(watch.watchId, schedule);
        return { watch, schedule };
      })
      .filter(({ watch, schedule }) => schedule.dueAt <= now && !inFlight.has(watch.watchId))
      .sort((a, b) => a.schedule.dueAt - b.schedule.dueAt);
    for (const { watch } of due) {
      if (!slot(now)) break;
      read(watch.watchId, watch.threadId);
    }
  };

  publish();
  const stopTimer = clock.every(TICK_MS, () => {
    try {
      tick();
    } catch (error) {
      options.report(error);
    }
  });

  return {
    register: (request, routineId = null) => {
      const watch = store.transaction(() => registry.register(request, clock.now(), routineId));
      publish();
      return view(watch);
    },
    list: () => store.watches.list().map(view),
    routineOf: (watchId) => registry.routineOf(watchId),
    remove: (watchId) => {
      const removed = store.watches.delete(watchId);
      if (removed) publish();
      return removed;
    },
    pending: () => store.outbox.pending(),
    openBatch: () => store.batches.open(),
    getBatch: (batchId) => store.batches.get(batchId),
    ack: (ack) => store.transaction(() => lane.ack(ack)),
    tick,
    idle: async () => {
      while (work.size > 0) await Promise.all(work);
    },
    close: () => {
      closed = true;
      stopTimer();
    },
  };
}

function parseLine(line: string): unknown {
  try {
    const value: unknown = JSON.parse(line);
    return value;
  } catch {
    return undefined;
  }
}
