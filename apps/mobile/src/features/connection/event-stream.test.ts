import type { EventServerFrame } from '@morrowbot/contracts';
import { afterEach, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import type { LinkStatus } from '../../lib/host-connection.ts';
import { reconnectDelay } from './backoff.ts';
import { openEventStream, type EventStream, type OpenSocket } from './event-stream.ts';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const step of cleanup.splice(0).reverse()) step();
});

const openSocket: OpenSocket = (url, token, handlers) => {
  const ws = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
  ws.on('open', handlers.onOpen);
  ws.on('message', (data: Buffer) => {
    handlers.onMessage(data.toString('utf8'));
  });
  ws.on('close', handlers.onClose);
  ws.on('error', () => undefined);
  return {
    send: (text) => {
      ws.send(text);
    },
    close: () => {
      ws.terminate();
    },
  };
};

function stream(url: string, delays: number[], statuses: LinkStatus[], problems: string[]): EventStream {
  const opened = openEventStream({
    url,
    token: 't'.repeat(43),
    openSocket,
    delayFor: (attempt) => {
      delays.push(attempt);
      return 5;
    },
    now: () => 0,
    onStatus: (status) => statuses.push(status),
    report: (problem) => problems.push(problem),
  });
  cleanup.push(opened.close);
  return opened;
}

async function until(check: () => boolean): Promise<void> {
  while (!check()) await new Promise((resolve) => setTimeout(resolve, 5));
}

it('skips frames it does not know without dropping the socket, and sends only subscribe frames', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => server.once('listening', resolve));
  cleanup.push(() => {
    server.close();
  });
  const fromClient: unknown[] = [];
  server.on('connection', (ws) => {
    ws.on('message', (data: Buffer) => {
      fromClient.push(JSON.parse(data.toString('utf8')));
      ws.send(JSON.stringify({ kind: 'surface.updated', threadId: 't1' }));
      ws.send('not json');
      ws.send(JSON.stringify({ kind: 'usage.updated', pluginId: 'claude', accountKey: 'a', addedLater: true }));
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('not listening');
  const { port } = address;
  const frames: EventServerFrame[] = [];
  const statuses: LinkStatus[] = [];
  const problems: string[] = [];
  const events = stream(`http://127.0.0.1:${String(port)}`, [], statuses, problems);
  events.listen((frame) => frames.push(frame));
  events.watchThread('t1', { hostEpoch: 'e1', seq: 4 });
  await until(() => frames.length === 1);
  expect({ fromClient, frames, problems, statuses: statuses.map((status) => status.kind) }).toMatchInlineSnapshot(`
    {
      "frames": [
        {
          "accountKey": "a",
          "kind": "usage.updated",
          "pluginId": "claude",
        },
      ],
      "fromClient": [
        {
          "kind": "subscribe",
          "since": {
            "hostEpoch": "e1",
            "seq": 4,
          },
          "threadId": "t1",
        },
      ],
      "problems": [
        "Ignored an unknown host event: {"kind":"surface.updated","threadId":"t1"}",
        "Ignored an unknown host event: not json",
      ],
      "statuses": [
        "connecting",
        "online",
      ],
    }
  `);
});

it('backs off further on each failed attempt while the host is unreachable', async () => {
  const delays: number[] = [];
  const statuses: LinkStatus[] = [];
  stream('http://127.0.0.1:9', delays, statuses, []);
  await until(() => delays.length >= 3);
  expect({ attempts: delays.slice(0, 3), statuses: statuses.slice(0, 4).map((status) => status.kind) }).toMatchInlineSnapshot(`
    {
      "attempts": [
        1,
        2,
        3,
      ],
      "statuses": [
        "connecting",
        "reconnecting",
        "connecting",
        "reconnecting",
      ],
    }
  `);
});

it('doubles the wait up to 30 seconds, with jitter in the upper half', () => {
  expect([1, 2, 3, 6, 7, 20].map((attempt) => [reconnectDelay(attempt, () => 0), reconnectDelay(attempt, () => 1)])).toMatchInlineSnapshot(`
    [
      [
        250,
        500,
      ],
      [
        500,
        1000,
      ],
      [
        1000,
        2000,
      ],
      [
        8000,
        16000,
      ],
      [
        15000,
        30000,
      ],
      [
        15000,
        30000,
      ],
    ]
  `);
});
