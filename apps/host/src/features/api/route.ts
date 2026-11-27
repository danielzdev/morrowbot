import type { z } from 'zod';
import { invalid, type Body, type Reply } from './reply.ts';

/** A route's named path segments (`:id`); '' for a name the route does not have. */
export interface Params {
  get(name: string): string;
}

export interface RouteContext {
  readonly params: Params;
  readonly query: URLSearchParams;
  readonly body: () => Promise<Body>;
}

export interface Route {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** A path such as `/api/threads/:id/approvals/:approvalId`. */
  readonly path: string;
  readonly handle: (context: RouteContext) => Promise<Reply> | Reply;
}

export type PathMatch = { readonly kind: 'match'; readonly params: Params } | { readonly kind: 'no-match' } | { readonly kind: 'malformed' };

/** Matches a request path against a route path, decoding each named segment. */
export function matchPath(pattern: string, path: string): PathMatch {
  const want = pattern.split('/');
  const have = path.split('/');
  if (want.length !== have.length) return { kind: 'no-match' };
  const params = new Map<string, string>();
  for (const [index, segment] of want.entries()) {
    const actual = have[index] ?? '';
    if (!segment.startsWith(':')) {
      if (segment !== actual) return { kind: 'no-match' };
      continue;
    }
    if (actual === '') return { kind: 'no-match' };
    try {
      params.set(segment.slice(1), decodeURIComponent(actual));
    } catch {
      return { kind: 'malformed' };
    }
  }
  return { kind: 'match', params: { get: (name) => params.get(name) ?? '' } };
}

export type Parsed<T> = { readonly kind: 'ok'; readonly value: T } | { readonly kind: 'rejected'; readonly reply: Reply };

export async function parseBody<T extends z.ZodType>(context: RouteContext, schema: T): Promise<Parsed<z.output<T>>> {
  const body = await context.body();
  switch (body.kind) {
    case 'rejected':
      return body;
    case 'ok': {
      const parsed = schema.safeParse(body.value);
      return parsed.success ? { kind: 'ok', value: parsed.data } : { kind: 'rejected', reply: invalid(parsed.error) };
    }
  }
}
