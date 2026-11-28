import type { DatabaseSync } from 'node:sqlite';
import { CardBody, ThreadCard } from '@morrowbot/contracts';
import { z } from 'zod';
import { jsonColumn } from './columns.ts';

const CardRow = z
  .object({
    id: z.string(),
    thread_id: z.string(),
    generation_id: z.string(),
    message_id: z.string().nullable(),
    agent_id: z.string(),
    body: jsonColumn(CardBody),
    revision: z.number(),
    created_at: z.string(),
  })
  .transform((row) => ({
    id: row.id,
    threadId: row.thread_id,
    generationId: row.generation_id,
    messageId: row.message_id,
    agentId: row.agent_id,
    createdAt: row.created_at,
    revision: row.revision,
    body: row.body,
  }))
  .pipe(ThreadCard);

export interface CardRepository {
  /** Saves a card a running turn proposed (`messageId` null). */
  insert(card: ThreadCard): void;
  get(id: string): ThreadCard | undefined;
  /** Replaces the card's body and revision. */
  update(card: ThreadCard): void;
  /** How many cards the turn proposed that are not on a saved reply yet. */
  countOpen(generationId: string): number;
  /** Puts the turn's open cards on its reply `messageId`; with no reply (a turn that added nothing to the chat) they are dropped. */
  close(generationId: string, messageId: string | null): void;
  /** The chat's cards, oldest first: those on saved replies and those of the turn running now. */
  listByThread(threadId: string): ThreadCard[];
}

export function cardRepository(db: DatabaseSync): CardRepository {
  const insert = db.prepare(
    `INSERT INTO thread_cards (id, thread_id, generation_id, message_id, agent_id, body, revision, created_at)
     VALUES (:id, :threadId, :generationId, NULL, :agentId, :body, :revision, :createdAt)`,
  );
  const get = db.prepare('SELECT * FROM thread_cards WHERE id = ?');
  const update = db.prepare('UPDATE thread_cards SET body = ?, revision = ? WHERE id = ?');
  const countOpen = db.prepare('SELECT count(*) AS n FROM thread_cards WHERE generation_id = ? AND message_id IS NULL');
  const link = db.prepare('UPDATE thread_cards SET message_id = ? WHERE generation_id = ? AND message_id IS NULL');
  const drop = db.prepare('DELETE FROM thread_cards WHERE generation_id = ? AND message_id IS NULL');
  const byThread = db.prepare('SELECT * FROM thread_cards WHERE thread_id = ? ORDER BY seq');
  const Count = z.object({ n: z.number() });
  return {
    insert: (card) => {
      insert.run({
        id: card.id,
        threadId: card.threadId,
        generationId: card.generationId,
        agentId: card.agentId,
        body: JSON.stringify(card.body),
        revision: card.revision,
        createdAt: card.createdAt,
      });
    },
    get: (id) => {
      const row = get.get(id);
      return row === undefined ? undefined : CardRow.parse(row);
    },
    update: (card) => {
      update.run(JSON.stringify(card.body), card.revision, card.id);
    },
    countOpen: (generationId) => Count.parse(countOpen.get(generationId)).n,
    close: (generationId, messageId) => {
      if (messageId === null) drop.run(generationId);
      else link.run(messageId, generationId);
    },
    listByThread: (threadId) => byThread.all(threadId).map((row) => CardRow.parse(row)),
  };
}
