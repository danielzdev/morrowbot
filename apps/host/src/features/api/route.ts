import type { z } from 'zod';
import { invalid, type Body, type Reply } from './reply.ts';

export interface RouteContext {
  /** The `:id` path segment, or '' for routes without one. */
  readonly id: string;
  readonly body: () => Promise<Body>;
}

export interface Route {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: RegExp;
  readonly handle: (context: RouteContext) => Promise<Reply> | Reply;
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
