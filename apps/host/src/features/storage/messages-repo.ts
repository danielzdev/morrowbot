import type { DatabaseSync } from 'node:sqlite';
import { GenerationOutcome, LastMessage, Message } from '@morrowbot/contracts';
import { z } from 'zod';
import { AttachmentRow } from './attachments-repo.ts';
import { jsonColumn } from './columns.ts';

const MessageRow = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('user'), outcome: z.null(), seed_truncated: z.literal(0), attachments: jsonColumn(z.array(AttachmentRow)) }),
    z.object({ kind: z.literal('assistant'), outcome: jsonColumn(GenerationOutcome), seed_truncated: z.union([z.literal(0), z.literal(1)]) }),
  ])
  .and(z.object({ id: z.string(), thread_id: z.string(), text: z.string(), created_at: z.string() }))
  .transform((row) => {
    const base = { id: row.id, threadId: row.thread_id, text: row.text, createdAt: row.created_at };
    switch (row.kind) {
      case 'user':
        return { kind: row.kind, ...base, attachments: row.attachments };
      case 'assistant':
        return row.seed_truncated === 1
          ? { kind: row.kind, ...base, outcome: row.outcome, seedTruncated: true }
          : { kind: row.kind, ...base, outcome: row.outcome };
    }
  })
  .pipe(Message);

/** A message row's attachments as a JSON array, in the order they were sent. */
const ATTACHMENTS = `(
  SELECT json_group_array(json_object('id', a.id, 'kind', a.kind, 'name', a.name, 'mime_type', a.mime_type, 'size', a.size))
  FROM (SELECT * FROM attachments WHERE message_id = m.id ORDER BY position) a
) AS attachments`;

const PREVIEW_LENGTH = 400;
const BLANKS = 'char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)';

const LastMessageRow = z
  .object({ agent_id: z.string(), thread_id: z.string(), kind: z.string(), text: z.string(), created_at: z.string() })
  .transform((row) => ({ agentId: row.agent_id, threadId: row.thread_id, kind: row.kind, preview: preview(row.text), at: row.created_at }))
  .pipe(LastMessage);

const FailedRow = z.object({ failed: z.union([z.literal(0), z.literal(1)]) });

function preview(text: string): string {
  if (text.length <= PREVIEW_LENGTH) return text;
  const head = text.slice(0, PREVIEW_LENGTH + 1);
  const end = head.search(/\s\S*$/);
  return `${end > 0 ? head.slice(0, end).trimEnd() : ''}…`;
}

export interface MessageRepository {
  insert(message: Message): void;
  get(id: string): Message | undefined;
  listByThread(threadId: string): Message[];
  /** Each agent's newest message with text and no NUL, across all its threads, newest first. */
  lastByAgent(): LastMessage[];
  /** The thread's newest message with text and no NUL, or null. */
  lastInThread(threadId: string): LastMessage | null;
  /** Whether the thread's newest message is a reply that failed. */
  endsFailed(threadId: string): boolean;
}

export function messageRepository(db: DatabaseSync): MessageRepository {
  const insert = db.prepare(
    `INSERT INTO messages (id, thread_id, kind, text, outcome, seed_truncated, created_at)
     VALUES (:id, :threadId, :kind, :text, :outcome, :seedTruncated, :createdAt)`,
  );
  const get = db.prepare(`SELECT m.*, ${ATTACHMENTS} FROM messages m WHERE m.id = ?`);
  const listByThread = db.prepare(`SELECT m.*, ${ATTACHMENTS} FROM messages m WHERE m.thread_id = ? ORDER BY m.seq`);
  const link = db.prepare('UPDATE attachments SET message_id = ?, position = ? WHERE id = ? AND thread_id = ? AND message_id IS NULL');
  const lastByAgent = db.prepare(
    `SELECT agent_id, thread_id, kind, substr(body, 1, ${String(PREVIEW_LENGTH + 1)}) AS text, created_at FROM (
       SELECT t.agent_id, m.thread_id, m.kind, trim(m.text, ${BLANKS}) AS body, m.created_at, m.seq,
         row_number() OVER (PARTITION BY t.agent_id ORDER BY m.seq DESC) AS rank
       FROM messages m JOIN threads t ON t.id = m.thread_id
       WHERE trim(m.text, ${BLANKS}) <> '' AND instr(CAST(m.text AS BLOB), x'00') = 0
     ) WHERE rank = 1 ORDER BY seq DESC`,
  );
  const lastInThread = db.prepare(
    `SELECT t.agent_id, m.thread_id, m.kind, substr(trim(m.text, ${BLANKS}), 1, ${String(PREVIEW_LENGTH + 1)}) AS text, m.created_at
     FROM messages m JOIN threads t ON t.id = m.thread_id
     WHERE m.thread_id = ? AND trim(m.text, ${BLANKS}) <> '' AND instr(CAST(m.text AS BLOB), x'00') = 0
     ORDER BY m.seq DESC LIMIT 1`,
  );
  const endsFailed = db.prepare(
    `SELECT kind = 'assistant' AND json_extract(outcome, '$.kind') = 'failed' AS failed FROM messages WHERE thread_id = ? ORDER BY seq DESC LIMIT 1`,
  );
  return {
    insert: (message) => {
      const base = { id: message.id, threadId: message.threadId, text: message.text, createdAt: message.createdAt };
      switch (message.kind) {
        case 'user':
          insert.run({ ...base, kind: message.kind, outcome: null, seedTruncated: 0 });
          for (const [position, attachment] of message.attachments.entries()) {
            if (link.run(message.id, position, attachment.id, message.threadId).changes !== 1) {
              throw new Error('An attachment is missing or was sent already');
            }
          }
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
    lastByAgent: () => lastByAgent.all().map((row) => LastMessageRow.parse(row)),
    lastInThread: (threadId) => {
      const row = lastInThread.get(threadId);
      return row === undefined ? null : LastMessageRow.parse(row);
    },
    endsFailed: (threadId) => FailedRow.parse(endsFailed.get(threadId) ?? { failed: 0 }).failed === 1,
  };
}
