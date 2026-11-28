import type { DatabaseSync } from 'node:sqlite';
import { T3WatchEvent } from '@morrowbot/contracts';
import { z } from 'zod';

export const EventRow = z
  .object({
    event_id: z.string(),
    watch_id: z.string().nullable(),
    thread_id: z.string().nullable(),
    run_id: z.string().nullable(),
    kind: z.string(),
    fingerprint: z.string(),
    reason: z.string().nullable(),
    at: z.string(),
  })
  .transform((row) => {
    const common = { eventId: row.event_id, kind: row.kind, fingerprint: row.fingerprint, reason: row.reason, at: row.at };
    return row.watch_id === null
      ? { scope: 'service', ...common }
      : { scope: 'watch', watchId: row.watch_id, threadId: row.thread_id, runId: row.run_id, ...common };
  })
  .pipe(T3WatchEvent);

const EntryRow = z
  .object({ due_at: z.string(), deferrals: z.number().int(), counted_deferral_at: z.string().nullable(), unverified: z.number() })
  .loose()
  .transform((row) => ({
    event: EventRow.parse(row),
    dueAt: row.due_at,
    deferrals: row.deferrals,
    countedDeferralAt: row.counted_deferral_at,
    unverified: row.unverified === 1,
  }));

const CursorRow = z.object({ inode: z.string(), byte_offset: z.number() }).transform((row) => ({ inode: row.inode, offset: row.byte_offset }));

/** How far one file in the watch folder has been read: its inode, and the byte after the last line taken. */
export interface FileCursor {
  readonly inode: string;
  readonly offset: number;
}

/** A queued event and when it may go out next. */
export interface T3OutboxEntry {
  readonly event: T3WatchEvent;
  readonly dueAt: string;
  /** Counted deferrals so far; the third sends it once more, `unverified`. */
  readonly deferrals: number;
  readonly countedDeferralAt: string | null;
  readonly unverified: boolean;
}

export type T3OutboxSchedule = Omit<T3OutboxEntry, 'event'>;

export interface T3OutboxRepository {
  /**
   * Records a transition and queues it, in the caller's transaction. False (and nothing written) when the same
   * transition (watch, thread, run, kind and fingerprint) is recorded already.
   */
  queue(event: T3WatchEvent): boolean;
  get(eventId: string): T3WatchEvent | undefined;
  /** Events still waiting for an ack, oldest first. */
  pending(): T3WatchEvent[];
  /** Takes an acknowledged event off the queue; its record stays, so it is never queued again. */
  acknowledge(eventId: string): boolean;
  /** Forgets an event that was never sent, record and all, so a later real transition like it is not suppressed. */
  drop(eventId: string): void;
  /** Queued events not in a batch in flight, oldest first. */
  undelivered(): T3OutboxEntry[];
  entry(eventId: string): T3OutboxEntry | undefined;
  /** Takes an event out of its batch and sets when it may go out again. */
  reschedule(eventId: string, schedule: T3OutboxSchedule): void;
  /** Frees the event's transition key, so the same transition can be queued again under a new event id. */
  release(eventId: string): void;
  /** A watch's queued events that were never sent, oldest first. */
  undispatched(watchId: string): T3WatchEvent[];
  cursor(name: string): FileCursor | undefined;
  setCursor(name: string, cursor: FileCursor): void;
}

export function t3OutboxRepository(db: DatabaseSync): T3OutboxRepository {
  const insertEvent = db.prepare(
    `INSERT INTO t3_watch_events (event_id, watch_id, thread_id, run_id, kind, fingerprint, reason, at)
     VALUES (:eventId, :watchId, :threadId, :runId, :kind, :fingerprint, :reason, :at)
     ON CONFLICT DO NOTHING`,
  );
  const enqueue = db.prepare('INSERT INTO t3_outbox (event_id, queued_at, dispatched_at, due_at) VALUES (?, ?, NULL, ?)');
  const entryColumns = 'SELECT e.*, o.due_at, o.deferrals, o.counted_deferral_at, o.unverified FROM t3_watch_events e JOIN t3_outbox o ON o.event_id = e.event_id';
  const undelivered = db.prepare(`${entryColumns} WHERE o.dispatched_at IS NULL ORDER BY e.seq`);
  const entry = db.prepare(`${entryColumns} WHERE e.event_id = ?`);
  const reschedule = db.prepare(
    `UPDATE t3_outbox SET dispatched_at = NULL, due_at = :dueAt, deferrals = :deferrals,
       counted_deferral_at = :countedDeferralAt, unverified = :unverified
     WHERE event_id = :eventId`,
  );
  const release = db.prepare("UPDATE t3_watch_events SET fingerprint = fingerprint || ' (released ' || event_id || ')' WHERE event_id = ?");
  const get = db.prepare('SELECT * FROM t3_watch_events WHERE event_id = ?');
  const pending = db.prepare('SELECT e.* FROM t3_watch_events e JOIN t3_outbox o ON o.event_id = e.event_id ORDER BY e.seq');
  const acknowledge = db.prepare('DELETE FROM t3_outbox WHERE event_id = ?');
  const drop = db.prepare('DELETE FROM t3_watch_events WHERE event_id = ?');
  const undispatched = db.prepare(
    `SELECT e.* FROM t3_watch_events e JOIN t3_outbox o ON o.event_id = e.event_id
     WHERE e.watch_id = ? AND o.dispatched_at IS NULL ORDER BY e.seq`,
  );
  const cursor = db.prepare('SELECT inode, byte_offset FROM t3_watch_cursors WHERE name = ?');
  const setCursor = db.prepare(
    `INSERT INTO t3_watch_cursors (name, inode, byte_offset) VALUES (:name, :inode, :offset)
     ON CONFLICT (name) DO UPDATE SET inode = excluded.inode, byte_offset = excluded.byte_offset`,
  );
  const parse = (row: unknown): T3WatchEvent => EventRow.parse(row);
  return {
    queue: (event) => {
      const scoped =
        event.scope === 'watch'
          ? { watchId: event.watchId, threadId: event.threadId, runId: event.runId }
          : { watchId: null, threadId: null, runId: null };
      const inserted = insertEvent.run({
        eventId: event.eventId,
        kind: event.kind,
        fingerprint: event.fingerprint,
        reason: event.reason,
        at: event.at,
        ...scoped,
      });
      if (inserted.changes === 0) return false;
      enqueue.run(event.eventId, event.at, event.at);
      return true;
    },
    get: (eventId) => {
      const row = get.get(eventId);
      return row === undefined ? undefined : parse(row);
    },
    pending: () => pending.all().map(parse),
    acknowledge: (eventId) => acknowledge.run(eventId).changes > 0,
    drop: (eventId) => {
      drop.run(eventId);
    },
    undelivered: () => undelivered.all().map((row) => EntryRow.parse(row)),
    entry: (eventId) => {
      const row = entry.get(eventId);
      return row === undefined ? undefined : EntryRow.parse(row);
    },
    reschedule: (eventId, schedule) => {
      reschedule.run({
        eventId,
        dueAt: schedule.dueAt,
        deferrals: schedule.deferrals,
        countedDeferralAt: schedule.countedDeferralAt,
        unverified: schedule.unverified ? 1 : 0,
      });
    },
    release: (eventId) => {
      release.run(eventId);
    },
    undispatched: (watchId) => undispatched.all(watchId).map(parse),
    cursor: (name) => {
      const row = cursor.get(name);
      return row === undefined ? undefined : CursorRow.parse(row);
    },
    setCursor: (name, value) => {
      setCursor.run({ name, inode: value.inode, offset: value.offset });
    },
  };
}
