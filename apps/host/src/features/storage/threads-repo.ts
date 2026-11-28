import type { DatabaseSync } from 'node:sqlite';
import { Thread } from '@morrowbot/contracts';
import { z } from 'zod';

const ThreadRow = z
  .object({
    rowid: z.number().int().positive(),
    id: z.string(),
    agent_id: z.string(),
    title: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .transform((row): z.input<typeof Thread> => ({
    id: row.id,
    agentId: row.agent_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdSeq: row.rowid,
  }))
  .pipe(Thread);

export interface ThreadRepository {
  insert(thread: Omit<Thread, 'createdSeq'>): Thread;
  update(thread: Thread): void;
  /** Marks the thread as changed without touching anything else. */
  touch(id: string, at: string): void;
  delete(id: string): boolean;
  get(id: string): Thread | undefined;
  /** The agent's chats, oldest first; a sub-agent's chat is not one of them. */
  listByAgent(agentId: string): Thread[];
  /** Every agent's chats (no sub-agent's), most recently changed first. */
  listAll(): Thread[];
}

export function threadRepository(db: DatabaseSync): ThreadRepository {
  const insert = db.prepare(
    `INSERT INTO threads (id, agent_id, title, created_at, updated_at)
     VALUES (:id, :agentId, :title, :createdAt, :updatedAt)
     RETURNING rowid, *`,
  );
  const update = db.prepare('UPDATE threads SET title = :title, updated_at = :updatedAt WHERE id = :id');
  const touch = db.prepare('UPDATE threads SET updated_at = ? WHERE id = ?');
  const remove = db.prepare('DELETE FROM threads WHERE id = ?');
  const get = db.prepare('SELECT rowid, * FROM threads WHERE id = ?');
  const listByAgent = db.prepare('SELECT rowid, * FROM threads WHERE agent_id = ? AND parent_thread_id IS NULL ORDER BY created_at, rowid');
  const listAll = db.prepare('SELECT rowid, * FROM threads WHERE parent_thread_id IS NULL ORDER BY updated_at DESC, rowid DESC');
  return {
    insert: (thread) =>
      ThreadRow.parse(
        insert.get({ id: thread.id, agentId: thread.agentId, title: thread.title, createdAt: thread.createdAt, updatedAt: thread.updatedAt }),
      ),
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
    listAll: () => listAll.all().map((row) => ThreadRow.parse(row)),
  };
}
