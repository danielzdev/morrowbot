import { RegisterT3WatchRequest, type T3WatchList } from '@morrowbot/contracts';
import type { ApiServices } from './ports.ts';
import { json, noContent, notFound } from './reply.ts';
import { parseBody, type Route } from './route.ts';

/** Registering, listing and stopping T3 Code watches. Agents that cannot reach the API append to `requests.jsonl`. */
export function t3WatchRoutes({ t3Watches }: ApiServices): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/t3-watches',
      handle: () => {
        const body: T3WatchList = { watches: t3Watches.list() };
        return json(200, body);
      },
    },
    {
      method: 'POST',
      path: '/api/t3-watches',
      handle: async (context) => {
        const request = await parseBody(context, RegisterT3WatchRequest);
        return request.kind === 'rejected' ? request.reply : json(201, t3Watches.register(request.value));
      },
    },
    {
      method: 'DELETE',
      path: '/api/t3-watches/:id',
      handle: ({ params }) => (t3Watches.remove(params.get('id')) ? noContent() : notFound('T3 watch')),
    },
  ];
}
