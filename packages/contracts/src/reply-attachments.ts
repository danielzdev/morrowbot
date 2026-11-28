import { z } from 'zod';
import { EntityId } from './ids.ts';

/** Image types a reply shows inline. */
export const ReplyImageType = z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export type ReplyImageType = z.infer<typeof ReplyImageType>;

/** Video types a reply plays inline. */
export const ReplyVideoType = z.enum(['video/mp4', 'video/webm']);
export type ReplyVideoType = z.infer<typeof ReplyVideoType>;

/** Other files a reply offers to open or save. Anything not listed is `application/octet-stream`. */
export const ReplyFileType = z.enum(['application/pdf', 'application/zip', 'text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/octet-stream']);
export type ReplyFileType = z.infer<typeof ReplyFileType>;

/** The most files one reply carries. */
export const MAX_REPLY_ATTACHMENTS = 8;

/** The largest file an agent attaches: 100 MB. */
export const MAX_REPLY_ATTACHMENT_BYTES = 100 * 1024 * 1024;

/** The most one reply's files add up to: 200 MB. */
export const MAX_REPLY_ATTACHMENTS_BYTES = 200 * 1024 * 1024;

const FileName = z.string().min(1).max(255).regex(/^[^/\\\0]+$/, 'Use a file name, not a path').refine((name) => name !== '.' && name !== '..', 'Use a file name, not a path');
const Size = z.number().int().nonnegative().max(MAX_REPLY_ATTACHMENT_BYTES);

/**
 * A file an agent attached to its reply with `attach_files`. The host keeps a copy; its bytes are served at
 * `replyAttachmentPath(id)` to anyone who may view the reply's chat.
 */
export const ReplyAttachment = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('image'), id: EntityId, name: FileName, mimeType: ReplyImageType, size: Size }),
  z.strictObject({ kind: z.literal('video'), id: EntityId, name: FileName, mimeType: ReplyVideoType, size: Size }),
  z.strictObject({ kind: z.literal('file'), id: EntityId, name: FileName, mimeType: ReplyFileType, size: Size }),
]);
export type ReplyAttachment = z.infer<typeof ReplyAttachment>;

/** The host API path a reply attachment's bytes are fetched from (supports `Range`). */
export function replyAttachmentPath(id: string): string {
  return `/api/reply-attachments/${encodeURIComponent(id)}`;
}

/** Whether a client may hand the file straight to a viewer app: images, videos, PDFs and plain text. Others are only saved. */
export function opensInViewer(attachment: ReplyAttachment): boolean {
  return attachment.kind !== 'file' || (attachment.mimeType !== 'application/octet-stream' && attachment.mimeType !== 'application/zip');
}
