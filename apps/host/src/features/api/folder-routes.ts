import { CreateFolderRequest, UpdateFolderRequest } from '@morrowbot/contracts';
import type { ApiServices } from './ports.ts';
import { json, noContent, notFound } from './reply.ts';
import { parseBody, type Route } from './route.ts';

export function folderRoutes({ folders }: ApiServices): Route[] {
  return [
    {
      method: 'POST',
      path: '/api/folders',
      handle: async (context) => {
        const request = await parseBody(context, CreateFolderRequest);
        if (request.kind === 'rejected') return request.reply;
        return json(201, folders.create(request.value));
      },
    },
    {
      method: 'PATCH',
      path: '/api/folders/:id',
      handle: async (context) => {
        const request = await parseBody(context, UpdateFolderRequest);
        if (request.kind === 'rejected') return request.reply;
        const folder = folders.rename(context.params.get('id'), request.value);
        return folder === undefined ? notFound('Folder') : json(200, folder);
      },
    },
    {
      method: 'DELETE',
      path: '/api/folders/:id',
      handle: ({ params }) => (folders.delete(params.get('id')) ? noContent() : notFound('Folder')),
    },
  ];
}
