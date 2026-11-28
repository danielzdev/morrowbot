import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { fixtureStep } from './mcp-fixture.ts';

/**
 * A local MCP server for tests, speaking newline-delimited JSON-RPC on stdio. It acts as `FIXTURE_ACCOUNT`
 * and appends what it saw (cancellations, the sleeper it started) to the file `FIXTURE_LOG`.
 */
const account = process.env.FIXTURE_ACCOUNT ?? 'nobody';
const log = (line: string): void => {
  const file = process.env.FIXTURE_LOG;
  if (file !== undefined) appendFileSync(file, `${line}\n`);
};
const send = (message: object): void => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};
const LeakCall = z.looseObject({ id: z.union([z.string(), z.number()]), method: z.literal('tools/call'), params: z.looseObject({ arguments: z.looseObject({ text: z.literal('leak') }) }) });
const Cancelled = z.looseObject({ method: z.literal('notifications/cancelled'), params: z.looseObject({ requestId: z.union([z.string(), z.number()]) }) });

createInterface({ input: process.stdin }).on('line', (line) => {
  const message: unknown = JSON.parse(line);
  const leak = LeakCall.safeParse(message);
  if (leak.success) {
    send({ jsonrpc: '2.0', id: leak.data.id, error: { code: -32000, message: `Rejected token ${process.env.FIXTURE_TOKEN ?? ''}` } });
    return;
  }
  const cancelled = Cancelled.safeParse(message);
  if (cancelled.success) log(`cancelled ${String(cancelled.data.params.requestId)}`);
  const step = fixtureStep(message, 'plain', account);
  switch (step.kind) {
    case 'answer':
      send(step.body);
      break;
    case 'spawn': {
      const sleeper = spawn('sleep', ['600'], { stdio: 'ignore' });
      log(`sleeper ${String(sleeper.pid)}`);
      send({ jsonrpc: '2.0', id: step.id, result: { content: [{ type: 'text', text: 'started' }] } });
      break;
    }
    case 'env': {
      const seen = ['FIXTURE_ACCOUNT', 'PATH', 'MORROWBOT_HOST_ONLY'].map((name) => `${name}=${process.env[name] === undefined ? 'absent' : 'set'}`);
      send({ jsonrpc: '2.0', id: step.id, result: { content: [{ type: 'text', text: seen.join(' ') }] } });
      break;
    }
    case 'hold':
    case 'none':
      break;
  }
});
