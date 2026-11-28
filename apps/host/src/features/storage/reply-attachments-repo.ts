import type { DatabaseSync } from 'node:sqlite';
import { ReplyAttachment } from '@morrowbot/contracts';
import { z } from 'zod';

/** A reply attachment row (or the JSON object a message query builds from one) as the contract's `ReplyAttachment`. */
export const ReplyAttachmentRow = z
  .object({ id: z.string(), kind: z.string(), name: z.string(), mime_type: z.string(), size: z.number() })
  .transform((row) => ({ kind: row.kind, id: row.id, name: row.name, mimeType: row.mime_type, size: row.size }))
  .pipe(ReplyAttachment);

const StoredRow = z.object({ thread_id: z.string(), sha256: z.string() });
const IdRow = z.object({ id: z.string() });

/** A reply attachment with what the host keeps beside it. */
export interface StoredReplyAttachment {
  readonly attachment: ReplyAttachment;
  readonly threadId: string;
  readonly sha256: string;
}

export interface NewReplyAttachment {
  readonly attachment: ReplyAttachment;
  readonly threadId: string;
  readonly generationId: string;
  readonly sha256: string;
  readonly createdAt: string;
}

export interface ReplyAttachmentRepository {
  /** Saves a file for the turn's reply; false (nothing saved) when the turn has settled or is unknown. */
  insert(row: NewReplyAttachment): boolean;
  /** The turn's files not yet on a saved reply, oldest first. */
  listOpen(generationId: string): StoredReplyAttachment[];
  /** Puts the turn's open files on its reply `messageId`; with no reply they are dropped. */
  close(generationId: string, messageId: string | null): void;
  get(id: string): StoredReplyAttachment | undefined;
  /** Every saved id, so files without a row can be removed. */
  ids(): Set<string>;
}

export function replyAttachmentRepository(db: DatabaseSync): ReplyAttachmentRepository {
  const insert = db.prepare(
    `INSERT INTO reply_attachments (id, thread_id, generation_id, message_id, kind, name, mime_type, size, sha256, created_at)
     SELECT :id, :threadId, :generationId, NULL, :kind, :name, :mimeType, :size, :sha256, :createdAt
     FROM generations WHERE id = :generationId AND thread_id = :threadId AND settled = 0`,
  );
  const listOpen = db.prepare('SELECT * FROM reply_attachments WHERE generation_id = ? AND message_id IS NULL ORDER BY seq');
  const link = db.prepare('UPDATE reply_attachments SET message_id = ? WHERE generation_id = ? AND message_id IS NULL');
  const drop = db.prepare('DELETE FROM reply_attachments WHERE generation_id = ? AND message_id IS NULL');
  const get = db.prepare('SELECT * FROM reply_attachments WHERE id = ?');
  const ids = db.prepare('SELECT id FROM reply_attachments');
  const stored = (row: unknown): StoredReplyAttachment => {
    const { thread_id: threadId, sha256 } = StoredRow.parse(row);
    return { attachment: ReplyAttachmentRow.parse(row), threadId, sha256 };
  };
  return {
    insert: ({ attachment, threadId, generationId, sha256, createdAt }) =>
      insert.run({ id: attachment.id, threadId, generationId, kind: attachment.kind, name: attachment.name, mimeType: attachment.mimeType, size: attachment.size, sha256, createdAt })
        .changes === 1,
    listOpen: (generationId) => listOpen.all(generationId).map(stored),
    close: (generationId, messageId) => {
      if (messageId === null) drop.run(generationId);
      else link.run(messageId, generationId);
    },
    get: (id) => {
      const row = get.get(id);
      return row === undefined ? undefined : stored(row);
    },
    ids: () => new Set(ids.all().map((row) => IdRow.parse(row).id)),
  };
}
