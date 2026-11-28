import type { DatabaseSync } from 'node:sqlite';
import type { T3WatchEvent } from '@morrowbot/contracts';
import { z } from 'zod';
import { EventRow } from './t3-outbox-repo.ts';

/** A batch as stored, with its events in the order they were first sent. */
export interface T3BatchRecord {
  readonly batchId: string;
  readonly createdAt: string;
  /** How many times the sink took it; 0 until the first send went through. */
  readonly attempts: number;
  /** When it is sent again unless acknowledged first: its lease, or a retry after a failed send. */
  readonly resendAt: string;
  readonly ackedAt: string | null;
  readonly entries: readonly { readonly event: T3WatchEvent; readonly unverified: boolean }[];
}

const BatchRow = z.object({ batch_id: z.string(), created_at: z.string(), attempts: z.number().int(), resend_at: z.string(), acked_at: z.string().nullable() });
const EntryRow = z
  .object({ unverified: z.number() })
  .loose()
  .transform((row) => ({ event: EventRow.parse(row), unverified: row.unverified === 1 }));

export interface T3BatchRepository {
  /** The one batch not yet acknowledged, if any. */
  open(): T3BatchRecord | undefined;
  get(batchId: string): T3BatchRecord | undefined;
  /** Freezes a batch's events and takes them off the ready queue, in the caller's transaction. */
  insert(batch: Pick<T3BatchRecord, 'batchId' | 'createdAt' | 'resendAt'>, entries: readonly { readonly eventId: string; readonly unverified: boolean }[]): void;
  /** Records a send (or a failed one) and when to send again. */
  reschedule(batchId: string, attempts: number, resendAt: string): void;
  acknowledge(batchId: string, at: string): void;
}

export function t3BatchRepository(db: DatabaseSync): T3BatchRepository {
  const open = db.prepare('SELECT * FROM t3_batches WHERE acked_at IS NULL');
  const get = db.prepare('SELECT * FROM t3_batches WHERE batch_id = ?');
  const entries = db.prepare(
    `SELECT e.*, b.unverified FROM t3_batch_events b JOIN t3_watch_events e ON e.event_id = b.event_id
     WHERE b.batch_id = ? ORDER BY b.position`,
  );
  const insert = db.prepare('INSERT INTO t3_batches (batch_id, created_at, attempts, resend_at, acked_at) VALUES (?, ?, 0, ?, NULL)');
  const insertEntry = db.prepare('INSERT INTO t3_batch_events (batch_id, event_id, position, unverified) VALUES (?, ?, ?, ?)');
  const dispatch = db.prepare('UPDATE t3_outbox SET dispatched_at = ? WHERE event_id = ?');
  const reschedule = db.prepare('UPDATE t3_batches SET attempts = ?, resend_at = ? WHERE batch_id = ?');
  const acknowledge = db.prepare('UPDATE t3_batches SET acked_at = ? WHERE batch_id = ? AND acked_at IS NULL');
  const parse = (row: unknown): T3BatchRecord => {
    const batch = BatchRow.parse(row);
    return {
      batchId: batch.batch_id,
      createdAt: batch.created_at,
      attempts: batch.attempts,
      resendAt: batch.resend_at,
      ackedAt: batch.acked_at,
      entries: entries.all(batch.batch_id).map((entry) => EntryRow.parse(entry)),
    };
  };
  return {
    open: () => {
      const row = open.get();
      return row === undefined ? undefined : parse(row);
    },
    get: (batchId) => {
      const row = get.get(batchId);
      return row === undefined ? undefined : parse(row);
    },
    insert: (batch, list) => {
      insert.run(batch.batchId, batch.createdAt, batch.resendAt);
      list.forEach((entry, position) => {
        insertEntry.run(batch.batchId, entry.eventId, position, entry.unverified ? 1 : 0);
        dispatch.run(batch.createdAt, entry.eventId);
      });
    },
    reschedule: (batchId, attempts, resendAt) => {
      reschedule.run(attempts, resendAt, batchId);
    },
    acknowledge: (batchId, at) => {
      acknowledge.run(at, batchId);
    },
  };
}
