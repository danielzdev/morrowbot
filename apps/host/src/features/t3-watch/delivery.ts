import type { T3StatusRow, T3WatchAck, T3WatchEvent } from '@morrowbot/contracts';
import { batchPayload } from './batch-payload.ts';
import { deferred, flushAt, IDLE_MS, kindOrder, LEASE_MS, SEND_RETRY_MS } from './delivery-policy.ts';
import type { ProbeResult } from './observation.ts';
import type { T3BatchRecord, T3DeliverySink, T3OutboxEntry, T3WatchClock, T3WatchStore } from './ports.ts';
import type { Registry } from './registry.ts';

export type AckResult = { readonly kind: 'acked' } | { readonly kind: 'already_acked' } | { readonly kind: 'unknown_batch' };

export interface DeliveryOptions {
  readonly store: T3WatchStore;
  readonly registry: Registry;
  /** Null turns delivery off: events wait in the outbox. */
  readonly sink: T3DeliverySink | null;
  readonly clock: T3WatchClock;
  readonly dir: string;
  readonly newId: () => string;
  /** A fresh read within the service's read limits; undefined when no slot is free right now. */
  readonly read: (threadId: string) => Promise<ProbeResult> | undefined;
  readonly track: (work: Promise<void>) => void;
  readonly warn: (message: string) => void;
}

export interface DeliveryLane {
  /** Sends a due batch, or resends the one in flight once its lease (or retry) is due, when the orchestrator is idle. */
  tick(): void;
  /** Applies the orchestrator's ack for one batch. The caller runs the transaction. */
  ack(ack: T3WatchAck): AckResult;
}

type WatchEvent = Extract<T3WatchEvent, { scope: 'watch' }>;
type Check = { readonly kind: 'reading' } | { readonly kind: 'read'; readonly result: ProbeResult; readonly at: number };

const iso = (at: number): string => new Date(at).toISOString();

/** The kinds a fresh read confirms, on both sides; only these can be deferred, and so only these go out `unverified`. */
function checkedKind(event: T3WatchEvent): event is WatchEvent {
  return event.scope === 'watch' && (event.kind === 'finished' || event.kind === 'needs_you');
}

/** Events the host confirms with a fresh read before they go out. */
function needsCheck(entry: T3OutboxEntry): entry is T3OutboxEntry & { readonly event: WatchEvent } {
  return !entry.unverified && checkedKind(entry.event);
}

/**
 * One coalesced delivery lane. At most one batch is in flight; it is resent under the same ids until acknowledged.
 * Every change to the outbox, the batches and the watches an ack settles commits in one transaction.
 */
export function createDeliveryLane(options: DeliveryOptions): DeliveryLane {
  const { store, registry, sink, clock } = options;
  const checks = new Map<string, Check>();
  const idleSince = new Map<string, number>();
  let sending = false;
  let failedSends = 0;

  const watchRoutineOf = (event: T3WatchEvent): string | null => (event.scope === 'watch' ? registry.routineOf(event.watchId) : null);

  const resolveTarget = (watchRoutineId: string | null): { readonly kind: 'deliver'; readonly routineId: string | null } | { readonly kind: 'hold' } => {
    if (sink === null) return { kind: 'hold' };
    if (sink.targetFor === undefined) return { kind: 'deliver', routineId: null };
    const routineId = sink.targetFor(watchRoutineId);
    return routineId === null ? { kind: 'hold' } : { kind: 'deliver', routineId };
  };

  const trackIdle = (targets: ReadonlySet<string | null>, now: number): void => {
    if (sink === null) return;
    const activeKeys = new Set<string>();
    for (const target of targets) {
      const key = target ?? '';
      activeKeys.add(key);
      if (sink.busy(target)) idleSince.delete(key);
      else if (!idleSince.has(key)) idleSince.set(key, now);
    }
    for (const key of idleSince.keys()) if (!activeKeys.has(key)) idleSince.delete(key);
  };

  const isIdle = (routineId: string | null, now: number): boolean => {
    const since = idleSince.get(routineId ?? '');
    return since !== undefined && now - since >= IDLE_MS;
  };

  const status = (targetRoutineId: string | null): T3StatusRow[] =>
    store.watches
      .currentAll()
      .filter((watch) => watch.settledAt === null && watch.state !== 'superseded')
      .filter((watch) => {
        if (sink?.targetFor === undefined) return true;
        return sink.targetFor(registry.routineOf(watch.watchId)) === targetRoutineId;
      })
      .map(({ watchId, threadId, label, state, reason, runId }) => ({ watchId, threadId, label, state, reason, runId }));

  const send = (target: T3DeliverySink, batch: T3BatchRecord, targetRoutineId: string | null, now: number): void => {
    if (batch.entries.length === 0) {
      store.batches.acknowledge(batch.batchId, iso(now));
      return;
    }
    sending = true;
    const attempt = batch.attempts + 1;
    options.track(
      Promise.resolve()
        .then(() => target.deliver(batchPayload(batch, attempt, now, status(targetRoutineId), options.dir), targetRoutineId))
        .then((answer) => {
          const at = clock.now();
          switch (answer.kind) {
            case 'sent':
              failedSends = 0;
              store.batches.reschedule(batch.batchId, attempt, iso(at + LEASE_MS));
              return;
            case 'busy':
              idleSince.delete(targetRoutineId ?? '');
              return;
            case 'failed':
              failedSends += 1;
              store.batches.reschedule(batch.batchId, batch.attempts, iso(at + Math.min(SEND_RETRY_MS * 2 ** (failedSends - 1), LEASE_MS)));
              options.warn(`Could not send T3 watch batch ${batch.batchId}: ${answer.reason}`);
              return;
          }
        })
        .finally(() => {
          sending = false;
        }),
    );
  };

  /** Starts the fresh reads the due events still need; true once every one has its answer. */
  const checked = (entries: readonly (T3OutboxEntry & { readonly event: WatchEvent })[]): boolean => {
    let done = true;
    for (const { event } of entries) {
      const check = checks.get(event.eventId);
      if (check?.kind === 'read') continue;
      done = false;
      if (check?.kind === 'reading') continue;
      const reading = options.read(event.threadId);
      if (reading === undefined) continue;
      checks.set(event.eventId, { kind: 'reading' });
      options.track(
        reading
          .then((result) => {
            if (checks.has(event.eventId)) checks.set(event.eventId, { kind: 'read', result, at: clock.now() });
          })
          .finally(() => {
            if (checks.get(event.eventId)?.kind === 'reading') checks.delete(event.eventId);
          }),
      );
    }
    return done;
  };

  /** Confirms, drops or defers the due events, then freezes what is left as the next batch. */
  const compose = (ready: readonly T3OutboxEntry[], now: number): T3BatchRecord | undefined =>
    store.transaction(() => {
      const included: { readonly eventId: string; readonly unverified: boolean; readonly order: number }[] = [];
      for (const entry of ready) {
        const check = checks.get(entry.event.eventId);
        if (needsCheck(entry) && check?.kind === 'read') {
          const verdict = registry.revalidate(entry.event, check.result, check.at);
          if (verdict === 'superseded') continue;
          if (verdict === 'unverifiable') {
            const schedule = deferred(entry, now);
            store.outbox.reschedule(entry.event.eventId, schedule);
            if (!schedule.unverified) continue;
            included.push({ eventId: entry.event.eventId, unverified: true, order: kindOrder(entry.event.kind) });
            continue;
          }
        }
        included.push({ eventId: entry.event.eventId, unverified: entry.unverified, order: kindOrder(entry.event.kind) });
      }
      if (included.length === 0) return undefined;
      const batchId = options.newId();
      store.batches.insert(
        { batchId, createdAt: iso(now), resendAt: iso(now) },
        included.toSorted((a, b) => a.order - b.order),
      );
      return store.batches.get(batchId);
    });

  return {
    tick: () => {
      if (sink === null) return;
      const now = clock.now();
      const open = store.batches.open();
      const undelivered = store.outbox.undelivered();
      const activeTargets = new Set<string | null>();
      if (sink.targetFor === undefined) {
        activeTargets.add(null);
      } else {
        const defaultTarget = sink.targetFor(null);
        if (defaultTarget !== null) activeTargets.add(defaultTarget);
        for (const watch of store.watches.open()) {
          const target = sink.targetFor(registry.routineOf(watch.watchId));
          if (target !== null) activeTargets.add(target);
        }
        if (open !== undefined) {
          for (const { event } of open.entries) {
            const target = sink.targetFor(watchRoutineOf(event));
            if (target !== null) activeTargets.add(target);
          }
        }
        for (const entry of undelivered) {
          const target = sink.targetFor(watchRoutineOf(entry.event));
          if (target !== null) activeTargets.add(target);
        }
      }
      trackIdle(activeTargets, now);
      if (sending) return;
      if (open !== undefined) {
        checks.clear();
        const firstWatch = open.entries.find(({ event }) => event.scope === 'watch')?.event;
        const target = resolveTarget(firstWatch === undefined ? null : watchRoutineOf(firstWatch));
        if (target.kind === 'deliver' && isIdle(target.routineId, now) && now >= Date.parse(open.resendAt)) {
          send(sink, open, target.routineId, now);
        }
        return;
      }
      const ready = undelivered.filter((entry) => Date.parse(entry.dueAt) <= now);
      const firstDeliverable = ready
        .map((entry) => ({ entry, target: resolveTarget(watchRoutineOf(entry.event)) }))
        .find((each): each is { readonly entry: T3OutboxEntry; readonly target: { readonly kind: 'deliver'; readonly routineId: string | null } } => each.target.kind === 'deliver');
      if (firstDeliverable === undefined) {
        checks.clear();
        return;
      }
      const targetRoutineId = firstDeliverable.target.routineId;
      const group = ready.filter((entry) => {
        const target = resolveTarget(watchRoutineOf(entry.event));
        return target.kind === 'deliver' && target.routineId === targetRoutineId;
      });
      if (group.length === 0 || now < flushAt(group) || !isIdle(targetRoutineId, now)) {
        checks.clear();
        return;
      }
      if (!checked(group.filter(needsCheck))) return;
      const batch = compose(group, now);
      checks.clear();
      if (batch !== undefined) send(sink, batch, targetRoutineId, now);
    },
    ack: (ack) => {
      const batch = store.batches.get(ack.batchId);
      if (batch === undefined) return { kind: 'unknown_batch' };
      if (batch.ackedAt !== null) return { kind: 'already_acked' };
      const deferredIds = new Set(ack.deferredEventIds);
      const goneIds = new Set(ack.goneEventIds);
      const inBatch = new Set(batch.entries.map(({ event }) => event.eventId));
      const strays = [...deferredIds, ...goneIds].filter((id) => !inBatch.has(id));
      if (strays.length > 0) options.warn(`Ack for batch ${batch.batchId} names events not in it: ${strays.join(', ')}`);
      const unchecked = batch.entries.filter(({ event }) => deferredIds.has(event.eventId) && !checkedKind(event)).map(({ event }) => event.eventId);
      if (unchecked.length > 0) options.warn(`Ack for batch ${batch.batchId} defers events that are never re-checked; taken as handled: ${unchecked.join(', ')}`);
      const at = clock.now();
      for (const { event, unverified } of batch.entries) {
        if (unverified) registry.noticed(event, at);
        else if (deferredIds.has(event.eventId) && checkedKind(event)) {
          const entry = store.outbox.entry(event.eventId);
          if (entry !== undefined) store.outbox.reschedule(event.eventId, deferred(entry, at));
        } else if (goneIds.has(event.eventId)) registry.gone(event, at);
        else registry.settle(event, at);
      }
      store.batches.acknowledge(batch.batchId, iso(at));
      return { kind: 'acked' };
    },
  };
}
