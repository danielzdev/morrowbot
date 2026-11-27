/**
 * A small JSON-RPC 2.0 server for `json-rpc-process.test.ts`, one message per line on stdin and
 * stdout. `echo` answers its params; `fail` answers an error; `slow` answers after `params.ms`;
 * `ask` sends the client a request and answers with the client's reply (or error); `tell` sends a
 * notification, a non-JSON line and a non-JSON-RPC line; `exit` exits; `pid` answers its pid.
 */
import { createInterface } from 'node:readline';
import { z } from 'zod';

const Message = z.looseObject({
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});
const Slow = z.object({ ms: z.number() });
const waiting = new Map<string, (reply: unknown) => void>();
let asked = 0;

function send(message: Readonly<Record<string, unknown>>): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const message = Message.parse(JSON.parse(line));
  const { id, method, params } = message;
  if (method === undefined) {
    const answered = waiting.get(String(id));
    waiting.delete(String(id));
    answered?.(message.error === undefined ? { result: message.result } : { error: message.error });
    return;
  }
  if (id === undefined) {
    send({ method: 'heard', params: { method, params } });
    return;
  }
  switch (method) {
    case 'echo':
      send({ id, result: params });
      return;
    case 'fail':
      send({ id, error: { code: -32000, message: 'nope', data: { why: 'asked to' } } });
      return;
    case 'slow':
      setTimeout(() => {
        send({ id, result: 'late' });
      }, Slow.parse(params).ms);
      return;
    case 'ask': {
      const key = `server-${String(asked++)}`;
      waiting.set(key, (reply) => {
        send({ id, result: reply });
      });
      send({ id: key, method: 'question', params });
      return;
    }
    case 'tell':
      process.stdout.write('not json\n');
      send({ unrelated: true });
      send({ method: 'news', params: { n: 1 } });
      send({ id, result: 'told' });
      return;
    case 'pid':
      send({ id, result: process.pid });
      return;
    case 'exit':
      process.exit(3);
      break;
    default:
      send({ id, error: { code: -32601, message: `no method ${method}` } });
  }
});
