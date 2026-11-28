import { z } from 'zod';
import { McpFailure } from './channel.ts';

const Id = z.union([z.string(), z.number()]);
const RpcError = z.looseObject({ code: z.number(), message: z.string() });

/** A message from the server: a response to us, a request of its own, or a notification. */
export const ServerMessage = z.union([
  z.looseObject({ jsonrpc: z.literal('2.0'), id: Id, result: z.unknown() }).transform((m) => ({ kind: 'result' as const, id: m.id, result: m.result })),
  z.looseObject({ jsonrpc: z.literal('2.0'), id: Id.nullable(), error: RpcError }).transform((m) => ({ kind: 'error' as const, id: m.id, error: m.error })),
  z.looseObject({ jsonrpc: z.literal('2.0'), id: Id, method: z.string() }).transform((m) => ({ kind: 'request' as const, id: m.id, method: m.method })),
  z.looseObject({ jsonrpc: z.literal('2.0'), method: z.string() }).transform((m) => ({ kind: 'notification' as const, method: m.method })),
]);
export type ServerMessage = z.output<typeof ServerMessage>;

/** Our answer to a request from the server: `ping` is answered, anything else (sampling, roots, elicitation) is not offered. */
export function answerServer(id: string | number, method: string): object {
  return method === 'ping'
    ? { jsonrpc: '2.0', id, result: {} }
    : { jsonrpc: '2.0', id, error: { code: -32601, message: `MorrowBot does not offer ${method}` } };
}

export function rpcFailure(error: { readonly code: number; readonly message: string }): McpFailure {
  return new McpFailure('rpc', `The server answered with error ${String(error.code)}: ${error.message.slice(0, 500)}`);
}

/** Parses a JSON text into server messages (one message, or a batch); unparseable input gives none. */
export function parseMessages(text: string): ServerMessage[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  const items: unknown[] = Array.isArray(value) ? value : [value];
  return items.flatMap((item) => {
    const parsed = ServerMessage.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}
