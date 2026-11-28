import { ChatSettings, ModelFavoriteChange } from '@morrowbot/contracts';
import type { ApiServices } from './ports.ts';
import { json } from './reply.ts';
import { parseBody, type Route } from './route.ts';

/**
 * Settings › Chat and the composer's starred models, kept by the host so every window, device and turn
 * sees the same. Only the owner changes them.
 */
export function settingsRoutes({ settings }: ApiServices): Route[] {
  return [
    { method: 'GET', path: '/api/settings/chat', handle: () => json(200, settings.chat()) },
    {
      method: 'PUT',
      path: '/api/settings/chat',
      handle: async (context) => {
        const request = await parseBody(context, ChatSettings);
        if (request.kind === 'rejected') return request.reply;
        return json(200, settings.setChat(request.value));
      },
    },
    { method: 'GET', path: '/api/settings/model-favorites', handle: () => json(200, settings.modelFavorites()) },
    {
      method: 'POST',
      path: '/api/settings/model-favorites',
      handle: async (context) => {
        const request = await parseBody(context, ModelFavoriteChange);
        if (request.kind === 'rejected') return request.reply;
        return json(200, settings.changeModelFavorite(request.value));
      },
    },
  ];
}
