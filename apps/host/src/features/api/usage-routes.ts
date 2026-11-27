import { TokenRange } from '@morrowbot/contracts';
import type { ApiServices } from './ports.ts';
import { invalid, json } from './reply.ts';
import type { Route } from './route.ts';

export function usageRoutes({ usage }: ApiServices): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/usage/tokens',
      handle: ({ query }) => {
        const range = TokenRange.safeParse(query.get('range') ?? 'all');
        return range.success ? json(200, usage.tokens(range.data)) : invalid(range.error);
      },
    },
  ];
}
