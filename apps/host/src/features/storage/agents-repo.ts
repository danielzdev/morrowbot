import type { DatabaseSync } from 'node:sqlite';
import { Agent, AgentAvatar, AgentEmojiReplies, AgentWorkspace, ProviderBinding } from '@morrowbot/contracts';
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
  .transform((agent) => Agent.parse(agent));

export interface AgentRepository {
  insert(agent: Agent): void;
  update(agent: Agent): void;
  delete(id: string): boolean;
  get(id: string): Agent | undefined;
  list(): Agent[];
}

export function agentRepository(db: DatabaseSync): AgentRepository {
  const insert = db.prepare(
    `INSERT INTO agents (id, name, description, workspace, avatar, provider, folder_id, emoji_replies, created_at, updated_at)
     VALUES (:id, :name, :description, :workspace, :avatar, :provider, :folderId, :emojiReplies, :createdAt, :updatedAt)`,
  );
  const update = db.prepare(
    `UPDATE agents SET name = :name, description = :description, workspace = :workspace, avatar = :avatar,
       provider = :provider, folder_id = :folderId, emoji_replies = :emojiReplies, updated_at = :updatedAt WHERE id = :id`,
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
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  });
  return {
    insert: (agent) => {
      insert.run(params(agent));
    },
    update: (agent) => {
      const { id, name, description, workspace, avatar, provider, folderId, emojiReplies, updatedAt } = params(agent);
      update.run({ id, name, description, workspace, avatar, provider, folderId, emojiReplies, updatedAt });
    },
    delete: (id) => remove.run(id).changes > 0,
    get: (id) => {
      const row = get.get(id);
      return row === undefined ? undefined : AgentRow.parse(row);
    },
    list: () => list.all().map((row) => AgentRow.parse(row)),
  };
}
