import type { DatabaseSync } from 'node:sqlite';
import { Thread } from '@morrowbot/contracts';
import { z } from 'zod';

/** Which threads a listing returns: active (unarchived), archived only, or both. */
export type ThreadArchiveFilter = 'active' | 'archived' | 'all';

const ThreadRow = z
  .object({
    rowid: z.number().int().positive(),
    id: z.string(),
    agent_id: z.string(),
    title: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    archived_at: z.string().nullable(),
  })
  .transform((row): z.input<typeof Thread> => ({
    id: row.id,
    agentId: row.agent_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    createdSeq: row.rowid,
  }))
  .pipe(Thread);

export type NewThreadRecord = Omit<Thread, 'createdSeq' | 'archivedAt'> & { readonly archivedAt?: string | null };

export interface ThreadRepository {
  insert(thread: NewThreadRecord): Thread;
  update(thread: Thread): void;
  /** Sets or clears `archived_at` on a top-level chat; returns false for unknown or sub-agent chats. */
  setArchived(id: string, archivedAt: string | null): boolean;
  /** Marks the thread as changed without touching anything else. */
  touch(id: string, at: string): void;
  delete(id: string): boolean;
  get(id: string): Thread | undefined;
  /** The agent's chats (no sub-agent's): active oldest first, archived most recently archived first, or all oldest first. */
  listByAgent(agentId: string, filter?: ThreadArchiveFilter): Thread[];
  /** Every agent's chats (no sub-agent's), most recently changed (or archived) first. */
  listAll(filter?: ThreadArchiveFilter): Thread[];
}

export function threadRepository(db: DatabaseSync): ThreadRepository {
  const insert = db.prepare(
    `INSERT INTO threads (id, agent_id, title, created_at, updated_at, archived_at)
     VALUES (:id, :agentId, :title, :createdAt, :updatedAt, :archivedAt)
     RETURNING rowid, *`,
  );
  const update = db.prepare('UPDATE threads SET title = :title, updated_at = :updatedAt WHERE id = :id');
  const setArchived = db.prepare('UPDATE threads SET archived_at = ? WHERE id = ? AND parent_thread_id IS NULL');
  const touch = db.prepare('UPDATE threads SET updated_at = ? WHERE id = ?');
  const remove = db.prepare('DELETE FROM threads WHERE id = ?');
  const get = db.prepare('SELECT rowid, * FROM threads WHERE id = ?');
  const listByAgentActive = db.prepare(
    'SELECT rowid, * FROM threads WHERE agent_id = ? AND parent_thread_id IS NULL AND archived_at IS NULL ORDER BY created_at, rowid',
  );
  const listByAgentArchived = db.prepare(
    'SELECT rowid, * FROM threads WHERE agent_id = ? AND parent_thread_id IS NULL AND archived_at IS NOT NULL ORDER BY archived_at DESC, updated_at DESC, rowid DESC',
  );
  const listByAgentAll = db.prepare('SELECT rowid, * FROM threads WHERE agent_id = ? AND parent_thread_id IS NULL ORDER BY created_at, rowid');
  const listAllActive = db.prepare(
    'SELECT rowid, * FROM threads WHERE parent_thread_id IS NULL AND archived_at IS NULL ORDER BY updated_at DESC, rowid DESC',
  );
  const listAllArchived = db.prepare(
    'SELECT rowid, * FROM threads WHERE parent_thread_id IS NULL AND archived_at IS NOT NULL ORDER BY archived_at DESC, updated_at DESC, rowid DESC',
  );
  const listAllBoth = db.prepare('SELECT rowid, * FROM threads WHERE parent_thread_id IS NULL ORDER BY updated_at DESC, rowid DESC');
  return {
    insert: (thread) =>
      ThreadRow.parse(
        insert.get({
          id: thread.id,
          agentId: thread.agentId,
          title: thread.title,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
          archivedAt: thread.archivedAt ?? null,
        }),
      ),
    update: (thread) => {
      update.run({ id: thread.id, title: thread.title, updatedAt: thread.updatedAt });
    },
    setArchived: (id, archivedAt) => setArchived.run(archivedAt, id).changes > 0,
    touch: (id, at) => {
      touch.run(at, id);
    },
    delete: (id) => remove.run(id).changes > 0,
    get: (id) => {
      const row = get.get(id);
      return row === undefined ? undefined : ThreadRow.parse(row);
    },
    listByAgent: (agentId, filter = 'active') => {
      switch (filter) {
        case 'active':
          return listByAgentActive.all(agentId).map((row) => ThreadRow.parse(row));
        case 'archived':
          return listByAgentArchived.all(agentId).map((row) => ThreadRow.parse(row));
        case 'all':
          return listByAgentAll.all(agentId).map((row) => ThreadRow.parse(row));
      }
    },
    listAll: (filter = 'active') => {
      switch (filter) {
        case 'active':
          return listAllActive.all().map((row) => ThreadRow.parse(row));
        case 'archived':
          return listAllArchived.all().map((row) => ThreadRow.parse(row));
        case 'all':
          return listAllBoth.all().map((row) => ThreadRow.parse(row));
      }
    },
  };
}
