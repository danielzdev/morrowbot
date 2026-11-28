import type { DatabaseSync } from 'node:sqlite';
import { Attachment } from '@morrowbot/contracts';
import { z } from 'zod';

/** An attachment row (or the JSON object a message query builds from one) as the contract's `Attachment`. */
export const AttachmentRow = z
  .object({ id: z.string(), kind: z.string(), name: z.string(), mime_type: z.string().nullable(), size: z.number() })
  .transform((row) =>
    row.kind === 'image'
      ? { kind: row.kind, id: row.id, name: row.name, mimeType: row.mime_type, size: row.size }
      : { kind: row.kind, id: row.id, name: row.name, size: row.size },
  )
  .pipe(Attachment);

export interface AttachmentRepository {
  /** Keeps an upload to `threadId`; it is not part of any message yet. */
  insert(threadId: string, attachment: Attachment, createdAt: string): void;
  /** The thread's unsent uploads named by `ids`, in that order; undefined when one is missing or already sent. */
  pending(threadId: string, ids: readonly string[]): Attachment[] | undefined;
  get(id: string): Attachment | undefined;
  /** Every attachment id, so files without a row can be removed. */
  ids(): Set<string>;
  /** Removes uploads never sent and made before `at`; returns their ids. */
  deleteUnsentBefore(at: string): string[];
}

export function attachmentRepository(db: DatabaseSync): AttachmentRepository {
  const insert = db.prepare(
    `INSERT INTO attachments (id, thread_id, message_id, position, kind, name, mime_type, size, created_at)
     VALUES (:id, :threadId, NULL, 0, :kind, :name, :mimeType, :size, :createdAt)`,
  );
  const pending = db.prepare('SELECT * FROM attachments WHERE id = ? AND thread_id = ? AND message_id IS NULL');
  const get = db.prepare('SELECT * FROM attachments WHERE id = ?');
  const ids = db.prepare('SELECT id FROM attachments');
  const unsent = db.prepare('DELETE FROM attachments WHERE message_id IS NULL AND created_at < ? RETURNING id');
  const IdRow = z.object({ id: z.string() });
  return {
    insert: (threadId, attachment, createdAt) => {
      const mimeType = attachment.kind === 'image' ? attachment.mimeType : null;
      insert.run({ id: attachment.id, threadId, kind: attachment.kind, name: attachment.name, mimeType, size: attachment.size, createdAt });
    },
    pending: (threadId, wanted) => {
      const found: Attachment[] = [];
      for (const id of wanted) {
        const row = pending.get(id, threadId);
        if (row === undefined) return undefined;
        found.push(AttachmentRow.parse(row));
      }
      return found;
    },
    get: (id) => {
      const row = get.get(id);
      return row === undefined ? undefined : AttachmentRow.parse(row);
    },
    ids: () => new Set(ids.all().map((row) => IdRow.parse(row).id)),
    deleteUnsentBefore: (at) => unsent.all(at).map((row) => IdRow.parse(row).id),
  };
}
