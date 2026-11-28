import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { runOf, startKit, type Kit } from './testing/t3-watch-kit.ts';

let kit: Kit;
beforeEach(async () => {
  kit = await startKit();
});
afterEach(async () => {
  expect(kit.errors).toEqual([]);
  await kit.close();
});

const currentWatches = (): unknown => JSON.parse(readFileSync(path.join(kit.dir, 'current-watches.json'), 'utf8'));

it('drops a superseded watch’s unsent finished, and the replacement’s real finished still goes out', async () => {
  kit.t3.thread('mcp:redo');
  const first = kit.register({ threadId: 'mcp:redo', runId: runOf('mcp:redo', 1) });
  await kit.run(5000);
  kit.t3.finish('mcp:redo');
  await kit.run(30_000);
  const [stale] = kit.service.pending();
  kit.t3.startRun('mcp:redo', 2);
  const second = kit.register({ threadId: 'mcp:redo', runId: runOf('mcp:redo', 2) });
  const afterSupersede = { events: kit.events(), staleRecord: stale === undefined ? 'none' : kit.storage.t3Outbox.get(stale.eventId) ?? 'dropped' };
  await kit.run(5000);
  kit.t3.finish('mcp:redo');
  await kit.run(30_000);
  expect({ afterSupersede, events: kit.events(), watches: kit.watches() }).toMatchInlineSnapshot(`
    {
      "afterSupersede": {
        "events": [],
        "staleRecord": "dropped",
      },
      "events": [
        {
          "at": "+66s",
          "kind": "finished",
          "reason": null,
          "run": "#2",
          "thread": "mcp:redo",
        },
      ],
      "watches": [
        {
          "reason": "replaced by id-3",
          "run": "#1",
          "settled": false,
          "source": "registered",
          "state": "superseded",
          "thread": "mcp:redo",
        },
        {
          "reason": null,
          "run": "#2",
          "settled": false,
          "source": "registered",
          "state": "finished",
          "thread": "mcp:redo",
        },
      ],
    }
  `);
  expect(currentWatches()).toEqual({ threads: { 'mcp:redo': second.watchId } });
  expect(first.watchId).not.toBe(second.watchId);
});

it('never calls a sleep jump a stall, but does call 15 awake minutes without progress one', async () => {
  kit.t3.thread('mcp:sleepy');
  kit.t3.thread('mcp:stuck');
  kit.register({ threadId: 'mcp:sleepy', runId: runOf('mcp:sleepy', 1) });
  await kit.run(5000);
  await kit.step(45 * 60_000);
  await kit.run(30_000);
  const afterSleep = kit.events();
  kit.register({ threadId: 'mcp:stuck', runId: runOf('mcp:stuck', 1), stallAfterMin: 15 });
  await kit.run(16 * 60_000);
  expect({ afterSleep, after: kit.events() }).toMatchInlineSnapshot(`
    {
      "after": [
        {
          "at": "+3585s",
          "kind": "stalled",
          "reason": "no progress for 15 min",
          "run": "#1",
          "thread": "mcp:sleepy",
        },
        {
          "at": "+3636s",
          "kind": "stalled",
          "reason": "no progress for 15 min",
          "run": "#1",
          "thread": "mcp:stuck",
        },
      ],
      "afterSleep": [],
    }
  `);
});

it('reports a deleted thread as watch_missing after two not-found reads, while other threads and the service stay healthy', async () => {
  kit.t3.thread('mcp:gone');
  kit.t3.thread('mcp:fine');
  kit.register({ threadId: 'mcp:gone', runId: runOf('mcp:gone', 1) });
  kit.register({ threadId: 'mcp:fine', runId: runOf('mcp:fine', 1) });
  await kit.run(5000);
  kit.t3.threads.delete('mcp:gone');
  await kit.run(10_000);
  const afterOne = kit.events();
  await kit.run(30_000);
  expect({ afterOne, events: kit.events(), watches: kit.watches() }).toMatchInlineSnapshot(`
    {
      "afterOne": [],
      "events": [
        {
          "at": "+21s",
          "kind": "watch_missing",
          "reason": "not_found",
          "run": "#1",
          "thread": "mcp:gone",
        },
      ],
      "watches": [
        {
          "reason": "not_found",
          "run": "#1",
          "settled": false,
          "source": "registered",
          "state": "watch_missing",
          "thread": "mcp:gone",
        },
        {
          "reason": null,
          "run": "#1",
          "settled": false,
          "source": "registered",
          "state": "running",
          "thread": "mcp:fine",
        },
      ],
    }
  `);
});

it('sends one t3_unreachable for a T3 restart, keeps thread states, and reconciles without duplicates', async () => {
  kit.t3.thread('mcp:ask', { status: 'waiting', pendingRequestCount: 1 });
  kit.t3.thread('mcp:work');
  kit.register({ threadId: 'mcp:ask', runId: runOf('mcp:ask', 1) });
  kit.register({ threadId: 'mcp:work', runId: runOf('mcp:work', 1) });
  await kit.run(5000);
  kit.t3.down = true;
  await kit.run(120_000);
  const duringOutage = { events: kit.events(), watches: kit.watches() };
  kit.t3.down = false;
  kit.t3.finish('mcp:work');
  await kit.run(90_000);
  expect({ duringOutage, after: kit.events() }).toMatchInlineSnapshot(`
    {
      "after": [
        {
          "at": "+1s",
          "kind": "needs_you",
          "reason": "1 pending request(s)",
          "run": "#1",
          "thread": "mcp:ask",
        },
        {
          "at": "+31s",
          "kind": "t3_unreachable",
          "reason": "Could not reach the T3 Code server at http://127.0.0.1:3773.",
        },
        {
          "at": "+151s",
          "kind": "finished",
          "reason": null,
          "run": "#1",
          "thread": "mcp:work",
        },
      ],
      "duringOutage": {
        "events": [
          {
            "at": "+1s",
            "kind": "needs_you",
            "reason": "1 pending request(s)",
            "run": "#1",
            "thread": "mcp:ask",
          },
          {
            "at": "+31s",
            "kind": "t3_unreachable",
            "reason": "Could not reach the T3 Code server at http://127.0.0.1:3773.",
          },
        ],
        "watches": [
          {
            "reason": null,
            "run": "#1",
            "settled": false,
            "source": "registered",
            "state": "needs_you",
            "thread": "mcp:ask",
          },
          {
            "reason": null,
            "run": "#1",
            "settled": false,
            "source": "registered",
            "state": "running",
            "thread": "mcp:work",
          },
        ],
      },
    }
  `);
});

it('picks up after a host restart with no duplicate events and no re-registration', async () => {
  kit.t3.thread('mcp:ask', { status: 'waiting', pendingRequestCount: 1 });
  kit.t3.thread('mcp:work');
  const line = (threadId: string): string => `${JSON.stringify({ threadId, launchedAt: new Date(kit.clock.now()).toISOString(), runId: runOf(threadId, 1) })}\n`;
  mkdirSync(kit.dir, { recursive: true });
  appendFileSync(path.join(kit.dir, 'requests.jsonl'), line('mcp:ask') + line('mcp:work'));
  await kit.run(5000);
  kit.t3.finish('mcp:work');
  await kit.run(10_000);
  const before = { events: kit.events(), watches: kit.watches() };
  kit.restart();
  await kit.run(30_000);
  expect({ before, after: { events: kit.events(), watches: kit.watches() } }).toMatchInlineSnapshot(`
    {
      "after": {
        "events": [
          {
            "at": "+2s",
            "kind": "needs_you",
            "reason": "1 pending request(s)",
            "run": "#1",
            "thread": "mcp:ask",
          },
          {
            "at": "+36s",
            "kind": "finished",
            "reason": null,
            "run": "#1",
            "thread": "mcp:work",
          },
        ],
        "watches": [
          {
            "reason": null,
            "run": "#1",
            "settled": false,
            "source": "registered",
            "state": "needs_you",
            "thread": "mcp:ask",
          },
          {
            "reason": null,
            "run": "#1",
            "settled": false,
            "source": "registered",
            "state": "finished",
            "thread": "mcp:work",
          },
        ],
      },
      "before": {
        "events": [
          {
            "at": "+2s",
            "kind": "needs_you",
            "reason": "1 pending request(s)",
            "run": "#1",
            "thread": "mcp:ask",
          },
        ],
        "watches": [
          {
            "reason": null,
            "run": "#1",
            "settled": false,
            "source": "registered",
            "state": "needs_you",
            "thread": "mcp:ask",
          },
          {
            "reason": null,
            "run": "#1",
            "settled": false,
            "source": "registered",
            "state": "running",
            "thread": "mcp:work",
          },
        ],
      },
    }
  `);
});
