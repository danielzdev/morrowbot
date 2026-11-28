import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createInterface } from 'node:readline';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openHostToolsBridge, type AcpStdioServer, type HostToolsBridge } from './bridge.ts';

const TOKEN = 't'.repeat(40);
let host: Server;
let url = '';
let seen: string[] = [];
let refuse = false;
let bridge: HostToolsBridge | undefined;

/** A stand-in for the host's MCP endpoint: one JSON answer per POST, 202 for a notification, 401 for any other token. */
beforeEach(async () => {
  seen = [];
  refuse = false;
  host = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const message = typeof body === 'object' && body !== null ? body : {};
      const method = 'method' in message ? String(message.method) : '?';
      const authorized = !refuse && request.headers.authorization === `Bearer ${TOKEN}`;
      seen.push(`${method} authorized=${String(authorized)}`);
      if (!authorized) {
        response.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"This token is unknown, or its turn has ended"}');
        return;
      }
      if (!('id' in message)) {
        response.writeHead(202).end();
        return;
      }
      const result = method === 'tools/call' ? { content: [{ type: 'text', text: 'remembered' }] } : { protocolVersion: '2025-06-18' };
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    });
  });
  await new Promise<void>((resolve) => host.listen(0, '127.0.0.1', resolve));
  const address: AddressInfo | string | null = host.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  url = `http://127.0.0.1:${String(address.port)}/mcp`;
});

afterEach(async () => {
  await bridge?.close();
  bridge = undefined;
  await new Promise((resolve) => host.close(resolve));
});

/** Starts `server` as an agent does: its command and args, the agent's env plus the server's. */
function startCopy(server: AcpStdioServer): { send(message: object): void; next(): Promise<unknown>; end(): void; exited: Promise<number | null> } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const { name, value } of server.env) env[name] = value;
  const child = spawn(server.command, [...server.args], { env, stdio: ['pipe', 'pipe', 'ignore'] });
  const lines: string[] = [];
  const readers: ((line: string) => void)[] = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    const reader = readers.shift();
    if (reader === undefined) lines.push(line);
    else reader(line);
  });
  child.stdin.on('error', () => undefined);
  return {
    send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`),
    next: () => {
      const line = lines.shift();
      return line === undefined ? new Promise((resolve) => readers.push((each) => { resolve(JSON.parse(each)); })) : Promise.resolve(JSON.parse(line));
    },
    end: () => child.stdin.end(),
    exited: new Promise((resolve) => child.on('exit', resolve)),
  };
}

it('opens no server when the host offers no tools', async () => {
  expect((await openHostToolsBridge({ kind: 'none' })).servers).toEqual([]);
});

it("relays an agent's MCP messages to the host with the turn's token, which its command, args and env never hold", async () => {
  bridge = await openHostToolsBridge({ kind: 'mcp', url, token: TOKEN });
  const [server] = bridge.servers;
  if (server === undefined) throw new Error('no server');
  const copy = startCopy(server);
  copy.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  const initialized = await copy.next();
  copy.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  copy.send({ jsonrpc: '2.0', id: 'call', method: 'tools/call', params: { name: 'remember', arguments: { text: 'x' } } });
  expect({
    name: server.name,
    command: server.command === process.execPath,
    args: server.args.map((arg) => arg.replace(import.meta.dirname, '<acp>')),
    env: server.env.map(({ name }) => name),
    tokenInServer: JSON.stringify(server).includes(TOKEN),
    answers: [initialized, await copy.next()],
    seen,
  }).toMatchInlineSnapshot(`
    {
      "answers": [
        {
          "id": 1,
          "jsonrpc": "2.0",
          "result": {
            "protocolVersion": "2025-06-18",
          },
        },
        {
          "id": "call",
          "jsonrpc": "2.0",
          "result": {
            "content": [
              {
                "text": "remembered",
                "type": "text",
              },
            ],
          },
        },
      ],
      "args": [
        "--disable-sigusr1",
        "<acp>/bridge-process.ts",
      ],
      "command": true,
      "env": [
        "ORIBOT_BRIDGE_SOCKET",
        "ORIBOT_BRIDGE_KEY",
      ],
      "name": "oribot",
      "seen": [
        "initialize authorized=true",
        "notifications/initialized authorized=true",
        "tools/call authorized=true",
      ],
      "tokenInServer": false,
    }
  `);
  copy.end();
  expect(await copy.exited).toBe(0);
});

it('spends its key on the first copy: a later copy started with the same env exits without answering, and close ends the first', async () => {
  bridge = await openHostToolsBridge({ kind: 'mcp', url, token: TOKEN });
  const [server] = bridge.servers;
  if (server === undefined) throw new Error('no server');
  const first = startCopy(server);
  first.send({ jsonrpc: '2.0', id: 1, method: 'ping' });
  await first.next();
  const again = startCopy(server);
  again.send({ jsonrpc: '2.0', id: 1, method: 'ping' });
  const againExit = await again.exited;
  await bridge.close();
  bridge = undefined;
  expect({ againExit, firstExit: await first.exited, seen }).toMatchInlineSnapshot(`
    {
      "againExit": 1,
      "firstExit": 0,
      "seen": [
        "ping authorized=true",
      ],
    }
  `);
});

it('exits when the host refuses the token, as it does once the turn is over', async () => {
  bridge = await openHostToolsBridge({ kind: 'mcp', url, token: TOKEN });
  const [server] = bridge.servers;
  if (server === undefined) throw new Error('no server');
  const copy = startCopy(server);
  refuse = true;
  copy.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  expect({ exit: await copy.exited, seen }).toMatchInlineSnapshot(`
    {
      "exit": 0,
      "seen": [
        "tools/list authorized=false",
      ],
    }
  `);
});
