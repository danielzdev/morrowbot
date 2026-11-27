import type { DatabaseSync } from 'node:sqlite';
import { GenerationOutcome, Message } from '@morrowbot/contracts';
import { z } from 'zod';
import { jsonColumn } from './columns.ts';

const MessageRow = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('user'), outcome: z.null(), seed_truncated: z.literal(0) }),
    z.object({ kind: z.literal('assistant'), outcome: jsonColumn(GenerationOutcome), seed_truncated: z.union([z.literal(0), z.literal(1)]) }),
  ])
  .and(z.object({ id: z.string(), thread_id: z.string(), text: z.string(), created_at: z.string() }))
  .transform((row) => {
    const base = { id: row.id, threadId: row.thread_id, text: row.text, createdAt: row.created_at };
    switch (row.kind) {
      case 'user':
        return { kind: row.kind, ...base };
      case 'assistant':
        return row.seed_truncated === 1
          ? { kind: row.kind, ...base, outcome: row.outcome, seedTruncated: true }
          : { kind: row.kind, ...base, outcome: row.outcome };
    }
  })
  .pipe(Message);

export interface MessageRepository {
  insert(message: Message): void;
  get(id: string): Message | undefined;
  listByThread(threadId: string): Message[];
}

export function messageRepository(db: DatabaseSync): MessageRepository {
  const insert = db.prepare(
    `INSERT INTO messages (id, thread_id, kind, text, outcome, seed_truncated, created_at)
     VALUES (:id, :threadId, :kind, :text, :outcome, :seedTruncated, :createdAt)`,
  );
  const get = db.prepare('SELECT * FROM messages WHERE id = ?');
  const listByThread = db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY seq');
  return {
    insert: (message) => {
      const base = { id: message.id, threadId: message.threadId, text: message.text, createdAt: message.createdAt };
      switch (message.kind) {
        case 'user':
          insert.run({ ...base, kind: message.kind, outcome: null, seedTruncated: 0 });
          break;
        case 'assistant':
          insert.run({
            ...base,
            kind: message.kind,
            outcome: JSON.stringify(message.outcome),
            seedTruncated: message.seedTruncated === true ? 1 : 0,
          });
          break;
      }
    },
    get: (id) => {
      const row = get.get(id);
      return row === undefined ? undefined : MessageRow.parse(row);
    },
    listByThread: (threadId) => listByThread.all(threadId).map((row) => MessageRow.parse(row)),
  };
}
