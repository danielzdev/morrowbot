import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { T3Watch, T3WatchList } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FakeClock, FakeT3, runOf } from './testing/t3-watch-kit.ts';
import { startTestHost, type TestHost } from './testing/test-host.ts';

let dataDir: string;
let host: TestHost;
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'oribot-t3-api-'));
  const clock = new FakeClock();
  host = await startTestHost({ dataDir, t3Watch: { probe: new FakeT3(clock), clock } });
});
afterEach(async () => {
  await host.close();
  expect(host.errors).toEqual([]);
  await rm(dataDir, { recursive: true, force: true });
});

it('registers, lists and removes T3 watches over the API, and refuses a malformed registration', async () => {
  const refused = await host.call('POST', '/api/t3-watches', { threadId: 'mcp:a', runId: 'run:1' });
  const created = await host.call('POST', '/api/t3-watches', {
    threadId: 'mcp:a',
    launchedAt: '2026-11-28T09:00:00.000Z',
    runId: runOf('mcp:a', 1),
    label: 'build',
  });
  const watch = T3Watch.parse(created.body);
  const listed = T3WatchList.parse((await host.call('GET', '/api/t3-watches')).body);
  const current: unknown = JSON.parse(await readFile(path.join(dataDir, 't3-watch', 'current-watches.json'), 'utf8'));
  const removed = await host.call('DELETE', `/api/t3-watches/${watch.watchId}`);
  const again = await host.call('DELETE', `/api/t3-watches/${watch.watchId}`);
  expect({
    refused,
    created: { status: created.status, watch: { ...watch, watchId: '<id>' } },
    listed: listed.watches.map((each) => each.watchId === watch.watchId),
    current,
    removed: removed.status,
    again: again.status,
    afterRemoving: T3WatchList.parse((await host.call('GET', '/api/t3-watches')).body).watches,
  }).toMatchInlineSnapshot(`
    {
      "afterRemoving": [],
      "again": 404,
      "created": {
        "status": 201,
        "watch": {
          "label": "build",
          "reason": null,
          "registeredAt": "2026-11-28T09:00:00.000Z",
          "runId": "run:thread:mcp%3Aa:ordinal:1",
          "settledAt": null,
          "source": "registered",
          "state": "watching",
          "threadId": "mcp:a",
          "updatedAt": "2026-11-28T09:00:00.000Z",
          "watchId": "<id>",
        },
      },
      "current": {
        "threads": {
          "mcp:a": "id-1",
        },
      },
      "listed": [
        true,
      ],
      "refused": {
        "body": {
          "error": {
            "kind": "invalid_request",
            "message": "launchedAt: Invalid input: expected string, received undefined",
          },
        },
        "status": 400,
      },
      "removed": 204,
    }
  `);
});
