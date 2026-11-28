import { stat } from 'node:fs/promises';
import { MAX_IMAGE_BYTES, UploadAttachmentRequest, type ReplyAttachment } from '@morrowbot/contracts';
import { byteRange } from './file-reply.ts';
import type { ApiServices } from './ports.ts';
import { failure, json, notFound, type Reply } from './reply.ts';
import { parseBody, type Route } from './route.ts';

/** An upload body: an image's base64 is 4/3 its size, plus room for the JSON around it. */
const UPLOAD_BODY_BYTES = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 64 * 1024;

export function attachmentRoutes({ attachments }: ApiServices): Route[] {
  return [
    {
      method: 'POST',
      path: '/api/threads/:id/attachments',
      access: { kind: 'thread', need: 'view' },
      bodyBytes: UPLOAD_BODY_BYTES,
      handle: async (context) => {
        const request = await parseBody(context, UploadAttachmentRequest);
        if (request.kind === 'rejected') return request.reply;
        const result = await attachments.upload(context.params.get('id'), request.value);
        switch (result.kind) {
          case 'saved':
            return json(201, result.attachment);
          case 'not-found':
            return notFound('Thread');
          case 'invalid':
            return failure('invalid_request', result.reason);
        }
      },
    },
    {
      method: 'GET',
      path: '/api/attachments/:id',
      access: { kind: 'attachment' },
      handle: async ({ params }) => {
        const content = await attachments.content(params.get('id'));
        return content === undefined ? notFound('Attachment') : json(200, content);
      },
    },
    {
      method: 'GET',
      path: '/api/reply-attachments/:id',
      access: { kind: 'attachment' },
      handle: async ({ params, range }) => {
        const found = attachments.reply(params.get('id'));
        const size = found === undefined ? undefined : await stat(found.file).then(({ size: bytes }) => bytes, () => undefined);
        if (found === undefined || size === undefined) return notFound('Attachment');
        const headers = fileHeaders(found.attachment);
        const wanted = byteRange(range, size);
        switch (wanted.kind) {
          case 'whole':
            return { kind: 'file', status: 200, file: found.file, start: 0, end: size - 1, headers };
          case 'part':
            return { kind: 'file', status: 206, file: found.file, start: wanted.start, end: wanted.end, headers: { ...headers, 'content-range': `bytes ${String(wanted.start)}-${String(wanted.end)}/${String(size)}` } };
          case 'unsatisfiable':
            return { kind: 'empty', status: 416, headers: { 'content-range': `bytes */${String(size)}` } } satisfies Reply;
        }
      },
    },
  ];
}

/**
 * A reply file is served as the type its bytes were checked to be, never sniffed, sandboxed, and kept by the
 * client: its id always names the same bytes. Only images, videos and PDFs are shown inline.
 */
function fileHeaders(attachment: ReplyAttachment): Record<string, string> {
  const inline = attachment.kind !== 'file' || attachment.mimeType === 'application/pdf';
  return {
    'content-type': attachment.mimeType,
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
  };
}
