import { request } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { serveLoopback, type LoopbackServer } from './loopback.ts';

const TOKEN = 'a'.repeat(43);
let server: LoopbackServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function start(): Promise<LoopbackServer> {
  server = await serveLoopback({
    port: 0,
    token: TOKEN,
    subprotocol: 'test.v1',
    origin: /^chrome-extension:\/\/[a-z]+$/,
    maxMessageBytes: 1024,
    onConnection: (socket) => {
      socket.onMessage((text) => {
        socket.send(`${socket.origin} said ${text}`);
      });
    },
  });
  return server;
}

/** The status line the server answers an upgrade request with. */
function upgradeStatus(port: number, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const sent = request({
      host: '127.0.0.1',
      port,
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        ...headers,
      },
    });
    sent.on('upgrade', (response, socket) => {
      socket.destroy();
      resolve(`${String(response.statusCode)} ${response.headers['sec-websocket-protocol'] ?? ''}`);
    });
    sent.on('response', (response) => {
      resolve(String(response.statusCode));
    });
    sent.on('error', reject);
    sent.end();
  });
}

it('lets in only an extension origin that offers the subprotocol and the token', async () => {
  const { port } = await start();
  const good = { origin: 'chrome-extension://abc', 'sec-websocket-protocol': `test.v1, token.${TOKEN}` };
  expect({
    good: await upgradeStatus(port, good),
    wrongToken: await upgradeStatus(port, { ...good, 'sec-websocket-protocol': `test.v1, token.${'b'.repeat(43)}` }),
    noToken: await upgradeStatus(port, { ...good, 'sec-websocket-protocol': 'test.v1' }),
    noSubprotocol: await upgradeStatus(port, { ...good, 'sec-websocket-protocol': `token.${TOKEN}` }),
    webPage: await upgradeStatus(port, { ...good, origin: 'https://evil.example' }),
    noOrigin: await upgradeStatus(port, { 'sec-websocket-protocol': good['sec-websocket-protocol'] }),
    reboundHost: await upgradeStatus(port, { ...good, host: `evil.example:${String(port)}` }),
  }).toMatchInlineSnapshot(`
    {
      "good": "101 test.v1",
      "noOrigin": "403",
      "noSubprotocol": "400",
      "noToken": "401",
      "reboundHost": "403",
      "webPage": "403",
      "wrongToken": "401",
    }
  `);
});

it('carries text frames both ways once connected', async () => {
  const { port } = await start();
  const client = new WebSocket(`ws://127.0.0.1:${String(port)}/`, {
    protocols: ['test.v1', `token.${TOKEN}`],
    headers: { origin: 'chrome-extension://abc' },
  });
  const reply = await new Promise<unknown>((resolve, reject) => {
    client.onopen = () => {
      client.send('hi');
    };
    client.onmessage = (event: MessageEvent) => {
      resolve(event.data);
    };
    client.onerror = () => {
      reject(new Error('connection failed'));
    };
  });
  client.close();
  expect({ protocol: client.protocol, reply }).toMatchInlineSnapshot(`
    {
      "protocol": "test.v1",
      "reply": "chrome-extension://abc said hi",
    }
  `);
});

it('says which port is taken', async () => {
  const { port } = await start();
  await expect(
    serveLoopback({ port, token: TOKEN, subprotocol: 'x', origin: /x/, maxMessageBytes: 1, onConnection: () => undefined }),
  ).rejects.toThrow(`Port ${String(port)} on 127.0.0.1 is already in use`);
});
