import type { DatabaseSync } from 'node:sqlite';
import { GenerationOutcome, Message } from '@morrowbot/contracts';
import { z } from 'zod';
import { jsonColumn } from './columns.ts';

const MessageRow = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('user'), outcome: z.null() }),
    z.object({ kind: z.literal('assistant'), outcome: jsonColumn(GenerationOutcome) }),
  ])
  .and(z.object({ id: z.string(), thread_id: z.string(), text: z.string(), created_at: z.string() }))
  .transform((row) => {
    const base = { id: row.id, threadId: row.thread_id, text: row.text, createdAt: row.created_at };
    switch (row.kind) {
      case 'user':
        return { kind: row.kind, ...base };
      case 'assistant':
        return { kind: row.kind, ...base, outcome: row.outcome };
    }
  })
  .pipe(Message);

export interface MessageRepository {
  insert(message: Message): void;
  listByThread(threadId: string): Message[];
}

export function messageRepository(db: DatabaseSync): MessageRepository {
  const insert = db.prepare(
    `INSERT INTO messages (id, thread_id, kind, text, outcome, created_at)
     VALUES (:id, :threadId, :kind, :text, :outcome, :createdAt)`,
  );
  const listByThread = db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY seq');
  return {
    insert: (message) => {
      const base = { id: message.id, threadId: message.threadId, text: message.text, createdAt: message.createdAt };
      switch (message.kind) {
        case 'user':
          insert.run({ ...base, kind: message.kind, outcome: null });
          break;
        case 'assistant':
          insert.run({ ...base, kind: message.kind, outcome: JSON.stringify(message.outcome) });
          break;
      }
    },
    listByThread: (threadId) => listByThread.all(threadId).map((row) => MessageRow.parse(row)),
  };
}
