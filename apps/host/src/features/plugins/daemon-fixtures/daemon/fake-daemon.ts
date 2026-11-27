/**
 * The shared daemon of the `daemon` fixture: one JSON message per line on stdin and stdout.
 * `turn` streams `<name>: <prompt>` and completes. Prompts pick other behaviors: `stall` waits for
 * `interrupt`; `ignore-interrupt` ignores interrupt and SIGTERM; `exit` makes the daemon exit.
 * Each SIGTERM is appended to `daemon-signals` in the working folder.
 */
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { z } from '@morrowbot/plugin-sdk';

const name = process.argv[2] ?? 'daemon';
const Request = z.discriminatedUnion('method', [
  z.strictObject({ id: z.number(), method: z.literal('hello') }),
  z.strictObject({ id: z.number(), method: z.literal('turn'), prompt: z.string() }),
  z.strictObject({ id: z.number(), method: z.literal('interrupt') }),
]);
const stalled = new Set<number>();
let ignoring = false;

function reply(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

process.on('SIGTERM', () => {
  appendFileSync('daemon-signals', `${name} SIGTERM\n`);
  if (!ignoring) process.exit(0);
});

createInterface({ input: process.stdin }).on('line', (line) => {
  const request = Request.parse(JSON.parse(line));
  switch (request.method) {
    case 'hello':
      reply({ kind: 'done', id: request.id, result: name });
      return;
    case 'interrupt':
      if (stalled.delete(request.id)) reply({ kind: 'done', id: request.id, result: 'cancelled' });
      return;
    case 'turn':
      switch (request.prompt) {
        case 'stall':
          stalled.add(request.id);
          return;
        case 'ignore-interrupt':
          ignoring = true;
          return;
        case 'exit':
          process.exit(9);
          break;
        default:
          reply({ kind: 'text', id: request.id, text: `${name}: ${request.prompt}` });
          reply({ kind: 'done', id: request.id, result: 'completed' });
      }
  }
});
