import type { DatabaseSync } from 'node:sqlite';
import { T3Watch } from '@morrowbot/contracts';
import { z } from 'zod';

/** A watch as stored: its public view plus the state machine's own memory (JSON the t3-watch feature parses). */
export type T3WatchRecord = T3Watch & { readonly memory: string };

const WatchRow = z
  .object({
    watch_id: z.string(),
    thread_id: z.string(),
    source: z.string(),
    label: z.string().nullable(),
    registered_at: z.string(),
    state: z.string(),
    reason: z.string().nullable(),
    run_id: z.string().nullable(),
    memory: z.string(),
    settled_at: z.string().nullable(),
    updated_at: z.string(),
  })
  .transform((row) => ({
    view: {
      watchId: row.watch_id,
      threadId: row.thread_id,
      source: row.source,
      label: row.label,
      state: row.state,
      reason: row.reason,
      runId: row.run_id,
      registeredAt: row.registered_at,
      settledAt: row.settled_at,
      updatedAt: row.updated_at,
    },
    memory: row.memory,
  }))
  .pipe(z.object({ view: T3Watch, memory: z.string() }))
  .transform(({ view, memory }): T3WatchRecord => ({ ...view, memory }));

const LIST_LIMIT = 200;

export interface T3WatchRepository {
  insert(record: T3WatchRecord): void;
  /** Saves what a read or an ack changed: state, reason, run, memory and settling. False when the watch is gone. */
  update(record: T3WatchRecord): boolean;
  delete(watchId: string): boolean;
  get(watchId: string): T3WatchRecord | undefined;
  /** The newest watches first, at most 200. */
  list(): T3WatchRecord[];
  /** Watches still being read (not terminal), oldest first. */
  open(): T3WatchRecord[];
  /** The thread's newest watch, which `current-watches.json` names. */
  current(threadId: string): T3WatchRecord | undefined;
  /** The thread's newest watch of each thread, oldest thread first. */
  currentAll(): T3WatchRecord[];
  /** The thread's watches a new registration supersedes: not superseded already, and not settled. */
  unsettled(threadId: string): T3WatchRecord[];
}

export function t3WatchRepository(db: DatabaseSync): T3WatchRepository {
  const insert = db.prepare(
    `INSERT INTO t3_watches (watch_id, thread_id, source, label, registered_at, state, reason, run_id, memory, settled_at, updated_at)
     VALUES (:watchId, :threadId, :source, :label, :registeredAt, :state, :reason, :runId, :memory, :settledAt, :updatedAt)`,
  );
  const update = db.prepare(
    `UPDATE t3_watches SET state = :state, reason = :reason, run_id = :runId, memory = :memory, settled_at = :settledAt,
       updated_at = :updatedAt
     WHERE watch_id = :watchId`,
  );
  const remove = db.prepare('DELETE FROM t3_watches WHERE watch_id = ?');
  const get = db.prepare('SELECT * FROM t3_watches WHERE watch_id = ?');
  const list = db.prepare('SELECT * FROM t3_watches ORDER BY seq DESC LIMIT ?');
  const open = db.prepare("SELECT * FROM t3_watches WHERE state IN ('watching', 'running', 'needs_you', 'stalled') ORDER BY seq");
  const current = db.prepare('SELECT * FROM t3_watches WHERE thread_id = ? ORDER BY seq DESC LIMIT 1');
  const currentAll = db.prepare('SELECT * FROM t3_watches WHERE seq IN (SELECT MAX(seq) FROM t3_watches GROUP BY thread_id) ORDER BY seq');
  const unsettled = db.prepare(
    "SELECT * FROM t3_watches WHERE thread_id = ? AND state <> 'superseded' AND settled_at IS NULL ORDER BY seq",
  );
  const parse = (row: unknown): T3WatchRecord => WatchRow.parse(row);
  const mutable = (record: T3WatchRecord) => ({
    watchId: record.watchId,
    state: record.state,
    reason: record.reason,
    runId: record.runId,
    memory: record.memory,
    settledAt: record.settledAt,
    updatedAt: record.updatedAt,
  });
  return {
    insert: (record) => {
      insert.run({ ...mutable(record), threadId: record.threadId, source: record.source, label: record.label, registeredAt: record.registeredAt });
    },
    update: (record) => update.run(mutable(record)).changes > 0,
    delete: (watchId) => remove.run(watchId).changes > 0,
    get: (watchId) => {
      const row = get.get(watchId);
      return row === undefined ? undefined : parse(row);
    },
    list: () => list.all(LIST_LIMIT).map(parse),
    open: () => open.all().map(parse),
    current: (threadId) => {
      const row = current.get(threadId);
      return row === undefined ? undefined : parse(row);
    },
    currentAll: () => currentAll.all().map(parse),
    unsettled: (threadId) => unsettled.all(threadId).map(parse),
  };
}
