import { MAX_IMAGE_BYTES, UploadAttachmentRequest } from '@morrowbot/contracts';
import type { ApiServices } from './ports.ts';
import { failure, json, notFound } from './reply.ts';
import { parseBody, type Route } from './route.ts';

/** An upload body: an image's base64 is 4/3 its size, plus room for the JSON around it. */
const UPLOAD_BODY_BYTES = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 64 * 1024;

export function attachmentRoutes({ attachments }: ApiServices): Route[] {
  return [
    {
      method: 'POST',
      path: '/api/threads/:id/attachments',
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
      handle: async ({ params }) => {
        const content = await attachments.content(params.get('id'));
        return content === undefined ? notFound('Attachment') : json(200, content);
      },
    },
  ];
}
