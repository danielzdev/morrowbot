import { CreateMemoryRequest, MAX_MEMORY_QUERY, type MemoryList, UpdateMemoryRequest } from '@morrowbot/contracts';
import type { ApiServices } from './ports.ts';
import { failure, json, noContent, notFound } from './reply.ts';
import { parseBody, type Route } from './route.ts';

export function memoryRoutes({ memories }: ApiServices): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/agents/:id/memories',
      handle: ({ params, query }) => {
        const q = query.get('q') ?? '';
        if (q.length > MAX_MEMORY_QUERY) return failure('invalid_request', `q: Keep the search under ${String(MAX_MEMORY_QUERY)} characters`);
        const found = memories.list(params.get('id'), q);
        if (found === undefined) return notFound('Agent');
        const body: MemoryList = { memories: found };
        return json(200, body);
      },
    },
    {
      method: 'POST',
      path: '/api/agents/:id/memories',
      handle: async (context) => {
        const request = await parseBody(context, CreateMemoryRequest);
        if (request.kind === 'rejected') return request.reply;
        const memory = memories.create(context.params.get('id'), request.value);
        return memory === undefined ? notFound('Agent') : json(201, memory);
      },
    },
    {
      method: 'PATCH',
      path: '/api/agents/:id/memories/:memoryId',
      handle: async (context) => {
        const request = await parseBody(context, UpdateMemoryRequest);
        if (request.kind === 'rejected') return request.reply;
        const memory = memories.update(context.params.get('id'), context.params.get('memoryId'), request.value);
        return memory === undefined ? notFound('Memory') : json(200, memory);
      },
    },
    {
      method: 'DELETE',
      path: '/api/agents/:id/memories/:memoryId',
      handle: ({ params }) => (memories.delete(params.get('id'), params.get('memoryId')) ? noContent() : notFound('Memory')),
    },
  ];
}
