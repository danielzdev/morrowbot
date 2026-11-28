import type { DatabaseSync } from 'node:sqlite';
import { BoundProvider, EntityId, SubagentRole, Thread, Timestamp } from '@morrowbot/contracts';
import { z } from 'zod';

/** Who started a sub-agent and how it runs. `threadId` is the sub-agent's own chat, a child of `parentThreadId`. */
export interface SubagentRecord {
  readonly threadId: string;
  readonly parentThreadId: string;
  readonly parentGenerationId: string;
  readonly role: string;
  readonly binding: BoundProvider;
  readonly createdAt: string;
}

const SubagentRow = z
  .object({
    thread_id: EntityId,
    parent_thread_id: EntityId,
    parent_generation_id: EntityId,
    role: SubagentRole,
    binding: z.string(),
    created_at: Timestamp,
  })
  .transform(
    (row): SubagentRecord => ({
      threadId: row.thread_id,
      parentThreadId: row.parent_thread_id,
      parentGenerationId: row.parent_generation_id,
      role: row.role,
      binding: BoundProvider.parse(JSON.parse(row.binding)),
      createdAt: row.created_at,
    }),
  );

export interface SubagentRunRepository {
  /** Saves the sub-agent's chat (`thread`, a child of the record's parent chat) and its record together. */
  insert(thread: Thread, record: SubagentRecord): void;
  get(threadId: string): SubagentRecord | undefined;
  /** The sub-agents a chat's turns started, oldest first. */
  listByParent(parentThreadId: string): SubagentRecord[];
  /** The sub-agents one turn started, oldest first. */
  listByGeneration(parentGenerationId: string): SubagentRecord[];
  /** Deletes the sub-agents whose turn was never admitted (their chat has no message); returns how many. */
  deleteUnstarted(): number;
}

const SELECT = `SELECT r.*, t.parent_thread_id FROM subagent_runs r JOIN threads t ON t.id = r.thread_id`;

export function subagentRunRepository(db: DatabaseSync): SubagentRunRepository {
  const insertThread = db.prepare(
    `INSERT INTO threads (id, agent_id, title, created_at, updated_at, parent_thread_id)
     VALUES (:id, :agentId, :title, :createdAt, :updatedAt, :parentThreadId)`,
  );
  const insertRun = db.prepare(
    `INSERT INTO subagent_runs (thread_id, parent_generation_id, role, binding, created_at)
     VALUES (:threadId, :parentGenerationId, :role, :binding, :createdAt)`,
  );
  const get = db.prepare(`${SELECT} WHERE r.thread_id = ?`);
  const listByParent = db.prepare(`${SELECT} WHERE t.parent_thread_id = ? ORDER BY r.created_at, r.rowid`);
  const listByGeneration = db.prepare(`${SELECT} WHERE r.parent_generation_id = ? ORDER BY r.created_at, r.rowid`);
  const deleteUnstarted = db.prepare(
    `DELETE FROM threads WHERE id IN (SELECT r.thread_id FROM subagent_runs r WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = r.thread_id))`,
  );
  return {
    insert: (thread, record) => {
      insertThread.run({ ...thread, parentThreadId: record.parentThreadId });
      insertRun.run({
        threadId: record.threadId,
        parentGenerationId: record.parentGenerationId,
        role: record.role,
        binding: JSON.stringify(record.binding),
        createdAt: record.createdAt,
      });
    },
    get: (threadId) => {
      const row = get.get(threadId);
      return row === undefined ? undefined : SubagentRow.parse(row);
    },
    listByParent: (parentThreadId) => listByParent.all(parentThreadId).map((row) => SubagentRow.parse(row)),
    listByGeneration: (parentGenerationId) => listByGeneration.all(parentGenerationId).map((row) => SubagentRow.parse(row)),
    deleteUnstarted: () => Number(deleteUnstarted.run().changes),
  };
}
