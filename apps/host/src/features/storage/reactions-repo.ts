import type { DatabaseSync } from 'node:sqlite';
import { MessageReaction, type ReactionActor } from '@morrowbot/contracts';
import { z } from 'zod';

const ReactionRow = z
  .object({ message_id: z.string(), actor: z.string(), emoji: z.string(), created_at: z.string() })
  .transform((row) => ({ messageId: row.message_id, actor: row.actor, emoji: row.emoji, createdAt: row.created_at }))
  .pipe(MessageReaction);

export interface ReactionRepository {
  /** False when the actor already has this emoji on the message. */
  add(reaction: MessageReaction): boolean;
  remove(messageId: string, actor: ReactionActor, emoji: string): boolean;
  listByMessage(messageId: string): MessageReaction[];
  listByThread(threadId: string): MessageReaction[];
}

export function reactionRepository(db: DatabaseSync): ReactionRepository {
  const add = db.prepare(
    `INSERT INTO message_reactions (message_id, actor, emoji, created_at) VALUES (:messageId, :actor, :emoji, :createdAt)
     ON CONFLICT DO NOTHING`,
  );
  const remove = db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND actor = ? AND emoji = ?');
  const byMessage = db.prepare('SELECT * FROM message_reactions WHERE message_id = ? ORDER BY created_at, rowid');
  const byThread = db.prepare(
    `SELECT r.* FROM message_reactions r JOIN messages m ON m.id = r.message_id WHERE m.thread_id = ? ORDER BY r.created_at, r.rowid`,
  );
  return {
    add: (reaction) => add.run({ ...reaction }).changes > 0,
    remove: (messageId, actor, emoji) => remove.run(messageId, actor, emoji).changes > 0,
    listByMessage: (messageId) => byMessage.all(messageId).map((row) => ReactionRow.parse(row)),
    listByThread: (threadId) => byThread.all(threadId).map((row) => ReactionRow.parse(row)),
  };
}
