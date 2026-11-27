import type { DatabaseSync } from 'node:sqlite';
import { Thread } from '@morrowbot/contracts';
import { z } from 'zod';

const ThreadRow = z
  .object({ id: z.string(), agent_id: z.string(), title: z.string(), created_at: z.string(), updated_at: z.string() })
  .transform((row) => ({
    id: row.id,
    agentId: row.agent_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
  .pipe(Thread);

export interface ThreadRepository {
  insert(thread: Thread): void;
  update(thread: Thread): void;
  /** Marks the thread as changed without touching anything else. */
  touch(id: string, at: string): void;
  delete(id: string): boolean;
  get(id: string): Thread | undefined;
  listByAgent(agentId: string): Thread[];
}

export function threadRepository(db: DatabaseSync): ThreadRepository {
  const insert = db.prepare(
    `INSERT INTO threads (id, agent_id, title, created_at, updated_at)
     VALUES (:id, :agentId, :title, :createdAt, :updatedAt)`,
  );
  const update = db.prepare('UPDATE threads SET title = :title, updated_at = :updatedAt WHERE id = :id');
  const touch = db.prepare('UPDATE threads SET updated_at = ? WHERE id = ?');
  const remove = db.prepare('DELETE FROM threads WHERE id = ?');
  const get = db.prepare('SELECT * FROM threads WHERE id = ?');
  const listByAgent = db.prepare('SELECT * FROM threads WHERE agent_id = ? ORDER BY created_at, rowid');
  return {
    insert: (thread) => {
      insert.run({ ...thread });
    },
    update: (thread) => {
      update.run({ id: thread.id, title: thread.title, updatedAt: thread.updatedAt });
    },
    touch: (id, at) => {
      touch.run(at, id);
    },
    delete: (id) => remove.run(id).changes > 0,
    get: (id) => {
      const row = get.get(id);
      return row === undefined ? undefined : ThreadRow.parse(row);
    },
    listByAgent: (agentId) => listByAgent.all(agentId).map((row) => ThreadRow.parse(row)),
  };
}
