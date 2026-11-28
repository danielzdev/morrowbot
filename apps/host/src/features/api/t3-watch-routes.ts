import { RegisterT3WatchRequest, T3WatchAck, type T3WatchAckResponse, type T3WatchList } from '@morrowbot/contracts';
import type { ApiServices } from './ports.ts';
import { json, noContent, notFound } from './reply.ts';
import { parseBody, type Route } from './route.ts';

/**
 * Registering, listing and stopping T3 Code watches, and the orchestrator's batch acks. Agents that cannot reach
 * the API append to `requests.jsonl` and `acks.jsonl` instead.
 */
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
      method: 'POST',
      path: '/api/t3-watches/acks',
      handle: async (context) => {
        const request = await parseBody(context, T3WatchAck);
        if (request.kind === 'rejected') return request.reply;
        const result = t3Watches.ack(request.value);
        if (result.kind === 'unknown_batch') return notFound('T3 watch batch');
        const body: T3WatchAckResponse = { result: result.kind };
        return json(200, body);
      },
    },
    {
      method: 'DELETE',
      path: '/api/t3-watches/:id',
      handle: ({ params }) => (t3Watches.remove(params.get('id')) ? noContent() : notFound('T3 watch')),
    },
  ];
}
