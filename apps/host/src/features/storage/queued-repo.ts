import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

/** A queued message as stored: its delivery state lives with the chat service, not on disk. */
export interface QueuedRecord {
  readonly id: string;
  readonly threadId: string;
  readonly text: string;
  readonly createdAt: string;
}

const QueuedRow = z
  .object({ id: z.string(), thread_id: z.string(), text: z.string(), created_at: z.string() })
  .transform((row): QueuedRecord => ({ id: row.id, threadId: row.thread_id, text: row.text, createdAt: row.created_at }));

export interface QueuedRepository {
  insert(record: QueuedRecord): void;
  delete(id: string): boolean;
  /** One thread's queue, oldest first. */
  listByThread(threadId: string): QueuedRecord[];
}

export function queuedRepository(db: DatabaseSync): QueuedRepository {
  const insert = db.prepare('INSERT INTO queued_messages (id, thread_id, text, created_at) VALUES (:id, :threadId, :text, :createdAt)');
  const remove = db.prepare('DELETE FROM queued_messages WHERE id = ?');
  const listByThread = db.prepare('SELECT * FROM queued_messages WHERE thread_id = ? ORDER BY seq');
  return {
    insert: (record) => {
      insert.run({ ...record });
    },
    delete: (id) => remove.run(id).changes > 0,
    listByThread: (threadId) => listByThread.all(threadId).map((row) => QueuedRow.parse(row)),
  };
}
