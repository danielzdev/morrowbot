import type { DatabaseSync } from 'node:sqlite';
import { AgentMessage } from '@morrowbot/contracts';
import { z } from 'zod';

const AgentMessageRow = z
  .object({
    id: z.string(),
    from_agent_id: z.string(),
    from_thread_id: z.string(),
    to_agent_id: z.string(),
    to_thread_id: z.string(),
    text: z.string(),
    expects_reply: z.union([z.literal(0), z.literal(1)]),
    reply_to_message_id: z.string().nullable(),
    depth: z.number(),
    created_at: z.string(),
  })
  .transform((row) => ({
    id: row.id,
    from: { agentId: row.from_agent_id, threadId: row.from_thread_id },
    to: { agentId: row.to_agent_id, threadId: row.to_thread_id },
    text: row.text,
    expectsReply: row.expects_reply === 1,
    replyToMessageId: row.reply_to_message_id,
    depth: row.depth,
    createdAt: row.created_at,
  }))
  .pipe(AgentMessage);

const CountRow = z.object({ count: z.number() });

export interface AgentMessageRepository {
  insert(message: AgentMessage): void;
  get(id: string): AgentMessage | undefined;
  hasReply(id: string): boolean;
  /** An agent's sent and received messages, oldest first; with `threadId`, only those shown in that chat. */
  list(agentId: string, threadId: string | null): AgentMessage[];
}

export function agentMessageRepository(db: DatabaseSync): AgentMessageRepository {
  const insert = db.prepare(
    `INSERT INTO agent_messages
       (id, from_agent_id, from_thread_id, to_agent_id, to_thread_id, text, expects_reply, reply_to_message_id, depth, created_at)
     VALUES (:id, :fromAgentId, :fromThreadId, :toAgentId, :toThreadId, :text, :expectsReply, :replyTo, :depth, :createdAt)`,
  );
  const get = db.prepare('SELECT * FROM agent_messages WHERE id = ?');
  const hasReply = db.prepare('SELECT COUNT(*) AS count FROM agent_messages WHERE reply_to_message_id = ?');
  const listAll = db.prepare('SELECT * FROM agent_messages WHERE from_agent_id = :agentId OR to_agent_id = :agentId ORDER BY created_at, rowid');
  const listThread = db.prepare(
    `SELECT * FROM agent_messages
     WHERE (from_agent_id = :agentId AND from_thread_id = :threadId) OR (to_agent_id = :agentId AND to_thread_id = :threadId)
     ORDER BY created_at, rowid`,
  );
  return {
    insert: (message) => {
      insert.run({
        id: message.id,
        fromAgentId: message.from.agentId,
        fromThreadId: message.from.threadId,
        toAgentId: message.to.agentId,
        toThreadId: message.to.threadId,
        text: message.text,
        expectsReply: message.expectsReply ? 1 : 0,
        replyTo: message.replyToMessageId,
        depth: message.depth,
        createdAt: message.createdAt,
      });
    },
    get: (id) => {
      const row = get.get(id);
      return row === undefined ? undefined : AgentMessageRow.parse(row);
    },
    hasReply: (id) => CountRow.parse(hasReply.get(id)).count > 0,
    list: (agentId, threadId) =>
      (threadId === null ? listAll.all({ agentId }) : listThread.all({ agentId, threadId })).map((row) => AgentMessageRow.parse(row)),
  };
}
