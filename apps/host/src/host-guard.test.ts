import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { startTestHost, type TestHost } from './testing/test-host.ts';

let dataDir: string;
let host: TestHost;
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'morrowbot-guard-'));
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
    await fetch(`${host.url}/api/agents`, { method: 'POST', body: '{"name":"x"}' }).then(async (response) => ({
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

it('serves only loopback clients that are not browser pages', async () => {
  const { port } = new URL(host.url);
  const raw = (headers: Record<string, string>, target = '/api/agents') =>
    new Promise<number | undefined>((resolve, reject) => {
      request({ host: '127.0.0.1', port, path: target, headers }, (response) => {
        response.resume();
        resolve(response.statusCode);
      })
        .on('error', reject)
        .end();
    });
  const socket = (origin: string | undefined) =>
    new Promise<string>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/events`, origin === undefined ? {} : { headers: { origin } });
      ws.addEventListener('open', () => {
        ws.close();
        resolve('open');
      });
      ws.addEventListener('error', () => {
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
    socket: await socket(undefined),
    browserSocket: await socket('https://evil.example'),
  }).toMatchInlineSnapshot(`
    {
      "browserOrigin": 403,
      "browserSocket": "refused",
      "health": 200,
      "loopback": 200,
      "malformedTarget": 404,
      "rebindingHost": 403,
      "socket": "open",
      "stillServing": 200,
      "upperCaseHost": 200,
    }
  `);
});
