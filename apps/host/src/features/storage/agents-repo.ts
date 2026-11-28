import type { DatabaseSync } from 'node:sqlite';
import { Agent, AgentAvatar, AgentEmojiReplies, AgentWorkspace, PluginId, ProviderBinding } from '@morrowbot/contracts';
import { z } from 'zod';
import { jsonColumn } from './columns.ts';

const AgentRow = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    workspace: jsonColumn(AgentWorkspace),
    avatar: jsonColumn(AgentAvatar),
    provider: jsonColumn(ProviderBinding),
    folder_id: z.string().nullable(),
    emoji_replies: AgentEmojiReplies,
    disabled_extensions: jsonColumn(z.array(PluginId)),
    revision: z.int().min(0),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .transform((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    workspace: row.workspace,
    avatar: row.avatar,
    provider: row.provider,
    folderId: row.folder_id,
    emojiReplies: row.emoji_replies,
    disabledExtensions: row.disabled_extensions,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
  .transform((agent) => Agent.parse(agent));

export type AgentWrite =
  | { readonly kind: 'updated'; readonly agent: Agent }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'conflict'; readonly current: Agent };

export interface AgentRepository {
  insert(agent: Agent): void;
  /**
   * Atomically updates an agent and increments its `revision`. When `expectedRevision` is provided,
   * refuses with `conflict` (carrying the current record) if the stored revision moved.
   */
  update(id: string, expectedRevision: number | undefined, change: (current: Agent) => Agent): AgentWrite;
  delete(id: string): boolean;
  get(id: string): Agent | undefined;
  list(): Agent[];
}

export function agentRepository(db: DatabaseSync): AgentRepository {
  const insert = db.prepare(
    `INSERT INTO agents (id, name, description, workspace, avatar, provider, folder_id, emoji_replies, disabled_extensions, revision, created_at, updated_at)
     VALUES (:id, :name, :description, :workspace, :avatar, :provider, :folderId, :emojiReplies, :disabledExtensions, :revision, :createdAt, :updatedAt)`,
  );
  const update = db.prepare(
    `UPDATE agents SET name = :name, description = :description, workspace = :workspace, avatar = :avatar,
       provider = :provider, folder_id = :folderId, emoji_replies = :emojiReplies, disabled_extensions = :disabledExtensions,
       revision = :revision, updated_at = :updatedAt WHERE id = :id`,
  );
  const remove = db.prepare('DELETE FROM agents WHERE id = ?');
  const get = db.prepare('SELECT * FROM agents WHERE id = ?');
  const list = db.prepare('SELECT * FROM agents ORDER BY created_at, rowid');
  const params = (agent: Agent) => ({
    id: agent.id,
    name: agent.name,
    description: agent.description,
    workspace: JSON.stringify(agent.workspace),
    avatar: JSON.stringify(agent.avatar),
    provider: JSON.stringify(agent.provider),
    folderId: agent.folderId,
    emojiReplies: agent.emojiReplies,
    disabledExtensions: JSON.stringify(agent.disabledExtensions),
    revision: agent.revision,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  });
  const inTransaction = <T>(work: () => T): T => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  return {
    insert: (agent) => {
      insert.run(params(agent));
    },
    update: (id, expectedRevision, change) =>
      inTransaction((): AgentWrite => {
        const row = get.get(id);
        if (row === undefined) return { kind: 'not-found' };
        const current = AgentRow.parse(row);
        if (expectedRevision !== undefined && current.revision !== expectedRevision) {
          return { kind: 'conflict', current };
        }
        const next = Agent.parse({ ...change(current), id: current.id, revision: current.revision + 1 });
        const { name, description, workspace, avatar, provider, folderId, emojiReplies, disabledExtensions, revision, updatedAt } = params(next);
        update.run({ id, name, description, workspace, avatar, provider, folderId, emojiReplies, disabledExtensions, revision, updatedAt });
        return { kind: 'updated', agent: next };
      }),
    delete: (id) => remove.run(id).changes > 0,
    get: (id) => {
      const row = get.get(id);
      return row === undefined ? undefined : AgentRow.parse(row);
    },
    list: () => list.all().map((row) => AgentRow.parse(row)),
  };
}
