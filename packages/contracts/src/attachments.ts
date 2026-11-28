import { z } from 'zod';
import { EntityId } from './ids.ts';

/** The image types the composer takes and vision providers are sent. */
export const ImageType = z.enum(['image/png', 'image/jpeg', 'image/webp']);
export type ImageType = z.infer<typeof ImageType>;

/** The most attachments one message carries. */
export const MAX_ATTACHMENTS = 8;

/** The largest image kept: 8 MB. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** The largest text file kept: 256 KB of UTF-8. */
export const MAX_TEXT_FILE_BYTES = 256 * 1024;

/** The longest base64 text of an image of `MAX_IMAGE_BYTES`. */
const MAX_IMAGE_BASE64 = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

const FileName = z.string().trim().min(1).max(255).regex(/^[^/\\\0]+$/, 'Use a file name, not a path');
const Base64 = z.string().max(MAX_IMAGE_BASE64).regex(/^[A-Za-z0-9+/]*={0,2}$/, 'Use base64');
const Size = z.number().int().nonnegative();

/** A file attached to a user message, as the chat shows it. The bytes are fetched by id. */
export const Attachment = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('image'), id: EntityId, name: FileName, mimeType: ImageType, size: Size.max(MAX_IMAGE_BYTES) }),
  z.strictObject({ kind: z.literal('text'), id: EntityId, name: FileName, size: Size.max(MAX_TEXT_FILE_BYTES) }),
]);
export type Attachment = z.infer<typeof Attachment>;

/** Uploads one file to a thread; it joins a message when a send names its id. */
export const UploadAttachmentRequest = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('image'), name: FileName, mimeType: ImageType, data: Base64 }),
  z.strictObject({ kind: z.literal('text'), name: FileName, text: z.string().max(MAX_TEXT_FILE_BYTES) }),
]);
export type UploadAttachmentRequest = z.infer<typeof UploadAttachmentRequest>;

/** A kept file's content: base64 for an image, the text itself for a text file. */
export const AttachmentContent = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('image'), mimeType: ImageType, data: Base64 }),
  z.strictObject({ kind: z.literal('text'), text: z.string().max(MAX_TEXT_FILE_BYTES) }),
]);
export type AttachmentContent = z.infer<typeof AttachmentContent>;
