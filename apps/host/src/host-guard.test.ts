import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startTestHost, type TestHost } from './testing/test-host.ts';

let dataDir: string;
let host: TestHost;
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'oribot-guard-'));
  host = await startTestHost({ dataDir });
});
afterEach(async () => {
  await host.close();
  await rm(dataDir, { recursive: true, force: true });
});

it('rejects bad requests with a reason', async () => {
  const replies = [
    await host.call('POST', '/api/agents', { name: '', workspace: { kind: 'shared', dir: 'relative' }, extra: 1 }),
    await host.call('POST', '/api/agents', { name: 'x', workspace: { kind: 'shared', dir: 'C:\\work' } }),
    await host.call('PATCH', '/api/agents/nope', { name: 'x' }),
    await host.call('PUT', '/api/agents', {}),
    await host.call('GET', '/api/nothing'),
    await fetch(`${host.url}/api/agents`, {
      method: 'POST',
      headers: { authorization: `Bearer ${host.host.token}` },
      body: '{"name":"x"}',
    }).then(async (response) => ({
      status: response.status,
      body: await response.json(),
    })),
  ];
  expect(replies).toMatchInlineSnapshot(`
    [
      {
        "body": {
          "error": {
            "kind": "invalid_request",
            "message": "name: Too small: expected string to have >=1 characters; workspace.dir: Use an absolute path; (body): Unrecognized key: "extra"",
          },
        },
        "status": 400,
      },
      {
        "body": {
          "error": {
            "kind": "invalid_request",
            "message": "workspace.dir: Use an absolute path on this computer",
          },
        },
        "status": 400,
      },
      {
        "body": {
          "error": {
            "kind": "not_found",
            "message": "Agent not found",
          },
        },
        "status": 404,
      },
      {
        "body": {
          "error": {
            "kind": "invalid_request",
            "message": "Method not allowed",
          },
        },
        "status": 405,
      },
      {
        "body": {
          "error": {
            "kind": "not_found",
            "message": "No such endpoint",
          },
        },
        "status": 404,
      },
      {
        "body": {
          "error": {
            "kind": "invalid_request",
            "message": "Send the body as application/json",
          },
        },
        "status": 415,
      },
    ]
  `);
});

it('serves only loopback clients that are not browser pages and hold this launch\'s token', async () => {
  const { port } = new URL(host.url);
  const bearer = `Bearer ${host.host.token}`;
  const raw = (headers: Record<string, string>, target = '/api/agents') =>
    new Promise<number | undefined>((resolve, reject) => {
      request({ host: '127.0.0.1', port, path: target, headers: { authorization: bearer, ...headers } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      })
        .on('error', reject)
        .end();
    });
  const socket = (headers: Record<string, string>) =>
    new Promise<string>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/events`, { headers: { authorization: bearer, ...headers } });
      ws.once('open', () => {
        ws.close();
        resolve('open');
      });
      ws.once('unexpected-response', (_request, response) => {
        resolve(`refused ${String(response.statusCode)}`);
      });
      ws.once('error', () => {
        resolve('refused');
      });
    });
  expect({
    health: (await host.call('GET', '/health')).status,
    loopback: await raw({}),
    rebindingHost: await raw({ host: `evil.example:${port}` }),
    upperCaseHost: await raw({ host: `LOCALHOST:${port}` }),
    malformedTarget: await raw({}, '//bad:port/api/agents'),
    stillServing: await raw({}),
    browserOrigin: await raw({ origin: 'https://evil.example' }),
    noToken: await raw({ authorization: '' }),
    lowercaseScheme: await raw({ authorization: `bearer ${host.host.token}` }),
    wrongToken: await raw({ authorization: `Bearer ${'x'.repeat(host.host.token.length)}` }),
    healthWithoutToken: await raw({ authorization: '' }, '/health'),
    socket: await socket({}),
    browserSocket: await socket({ origin: 'https://evil.example' }),
    sameOriginSocket: await socket({ origin: `http://127.0.0.1:${port}` }),
    socketWithoutToken: await socket({ authorization: '' }),
  }).toMatchInlineSnapshot(`
    {
      "browserOrigin": 403,
      "browserSocket": "refused 403",
      "health": 200,
      "healthWithoutToken": 401,
      "loopback": 200,
      "lowercaseScheme": 200,
      "malformedTarget": 404,
      "noToken": 401,
      "rebindingHost": 403,
      "sameOriginSocket": "open",
      "socket": "open",
      "socketWithoutToken": "refused 401",
      "stillServing": 200,
      "upperCaseHost": 200,
      "wrongToken": 401,
    }
  `);
});

it('survives peers that reset a refused /api/events upgrade', async () => {
  const { port } = new URL(host.url);
  const refusals = Array.from({ length: 50 }, () =>
    new Promise<void>((resolve) => {
      const peer = connect(Number(port), '127.0.0.1', () => {
        peer.write(`GET /api/events HTTP/1.1\r\nhost: 127.0.0.1:${port}\r\nupgrade: websocket\r\nconnection: upgrade\r\nsec-websocket-version: 13\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
        peer.resetAndDestroy();
        resolve();
      });
      peer.on('error', () => {
        resolve();
      });
    }),
  );
  await Promise.all(refusals);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect((await host.call('GET', '/health')).status).toBe(200);
});

it('cuts a refused /api/events upgrade even when the peer keeps its side open, so closing the host does not hang', async () => {
  const { port } = new URL(host.url);
  const peer = connect({ port: Number(port), host: '127.0.0.1', allowHalfOpen: true });
  const refused = new Promise<string>((resolve) => {
    peer.once('data', (data) => {
      resolve(data.toString('utf8').split('\r\n')[0] ?? '');
    });
  });
  peer.write(`GET /api/events HTTP/1.1\r\nhost: 127.0.0.1:${port}\r\nupgrade: websocket\r\nconnection: upgrade\r\nsec-websocket-version: 13\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
  const status = await refused;
  const closed = await Promise.race([
    host.close().then(() => 'closed'),
    new Promise<string>((resolve) => setTimeout(() => {
      resolve('still open after 2 s');
    }, 2000)),
  ]);
  peer.destroy();
  host = await startTestHost({ dataDir });
  expect({ status, closed }).toMatchInlineSnapshot(`
    {
      "closed": "closed",
      "status": "HTTP/1.1 401 Unauthorized",
    }
  `);
});
