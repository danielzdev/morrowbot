import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { jsonColumn } from './columns.ts';

/** A queued message as stored: its delivery state lives with the chat service, not on disk. */
export interface QueuedRecord {
  readonly id: string;
  readonly threadId: string;
  readonly text: string;
  readonly attachmentIds: readonly string[];
  readonly createdAt: string;
}

const QueuedRow = z
  .object({ id: z.string(), thread_id: z.string(), text: z.string(), attachment_ids: jsonColumn(z.array(z.string())), created_at: z.string() })
  .transform(
    (row): QueuedRecord => ({
      id: row.id,
      threadId: row.thread_id,
      text: row.text,
      attachmentIds: row.attachment_ids,
      createdAt: row.created_at,
    }),
  );

export interface QueuedRepository {
  insert(record: QueuedRecord): void;
  delete(id: string): boolean;
  /** One thread's queue, oldest first. */
  listByThread(threadId: string): QueuedRecord[];
}

export function queuedRepository(db: DatabaseSync): QueuedRepository {
  const insert = db.prepare(
    'INSERT INTO queued_messages (id, thread_id, text, attachment_ids, created_at) VALUES (:id, :threadId, :text, :attachmentIds, :createdAt)',
  );
  const remove = db.prepare('DELETE FROM queued_messages WHERE id = ?');
  const listByThread = db.prepare('SELECT * FROM queued_messages WHERE thread_id = ? ORDER BY seq');
  return {
    insert: (record) => {
      insert.run({
        id: record.id,
        threadId: record.threadId,
        text: record.text,
        attachmentIds: JSON.stringify(record.attachmentIds),
        createdAt: record.createdAt,
      });
    },
    delete: (id) => remove.run(id).changes > 0,
    listByThread: (threadId) => listByThread.all(threadId).map((row) => QueuedRow.parse(row)),
  };
}
