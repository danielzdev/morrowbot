import type { ApiServices } from './ports.ts';
import { json, notFound } from './reply.ts';
import type { Route } from './route.ts';

export function skillRoutes({ skills }: ApiServices): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/agents/:id/skills',
      handle: async ({ params }) => {
        const list = await skills.list(params.get('id'));
        return list === undefined ? notFound('Agent') : json(200, list);
      },
    },
  ];
}
