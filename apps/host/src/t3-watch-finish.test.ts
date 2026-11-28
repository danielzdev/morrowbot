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

/** Registers a watch on a fresh thread whose first run is running, bound to that run. */
function launch(threadId: string): void {
  kit.t3.thread(threadId);
  kit.register({ threadId, runId: runOf(threadId, 1) });
}

it('holds finished while a helper that started after the parent completed is still running', async () => {
  launch('mcp:parent');
  await kit.run(10_000);
  kit.t3.finish('mcp:parent');
  await kit.run(10_000);
  Object.assign(kit.t3.get('mcp:parent'), { pendingBackgroundTasks: [{ taskId: 'helper-1', kind: 'subagent' }] });
  await kit.run(60_000);
  const whileHelperRuns = kit.events();
  Object.assign(kit.t3.get('mcp:parent'), { pendingBackgroundTasks: [], itemCount: 9 });
  await kit.run(30_000);
  expect({ whileHelperRuns, after: kit.events() }).toMatchInlineSnapshot(`
    {
      "after": [
        {
          "at": "+101s",
          "kind": "finished",
          "reason": null,
          "run": "#1",
          "thread": "mcp:parent",
        },
      ],
      "whileHelperRuns": [],
    }
  `);
});

it('starts confirmation over after an unreadable read', async () => {
  launch('mcp:flap');
  await kit.run(1000);
  kit.t3.finish('mcp:flap');
  await kit.run(10_000);
  kit.t3.down = true;
  await kit.run(10_000);
  kit.t3.down = false;
  await kit.run(50_000);
  expect(kit.events()).toMatchInlineSnapshot(`
    [
      {
        "at": "+61s",
        "kind": "finished",
        "reason": null,
        "run": "#1",
        "thread": "mcp:flap",
      },
    ]
  `);
});

it('starts confirmation over after a contrary read', async () => {
  launch('mcp:flap');
  await kit.run(1000);
  kit.t3.finish('mcp:flap');
  await kit.run(10_000);
  const done = { ...kit.t3.get('mcp:flap') };
  Object.assign(kit.t3.get('mcp:flap'), { status: 'running', activeRunId: runOf('mcp:flap', 1) });
  await kit.run(10_000);
  Object.assign(kit.t3.get('mcp:flap'), done);
  await kit.run(30_000);
  expect(kit.events()).toMatchInlineSnapshot(`
    [
      {
        "at": "+51s",
        "kind": "finished",
        "reason": null,
        "run": "#1",
        "thread": "mcp:flap",
      },
    ]
  `);
});

it('queues one finished per thread for a four-thread burst, with no duplicates', async () => {
  for (const threadId of ['mcp:a', 'mcp:b', 'mcp:c', 'mcp:d']) launch(threadId);
  await kit.run(10_000);
  for (const threadId of ['mcp:a', 'mcp:b', 'mcp:c', 'mcp:d']) kit.t3.finish(threadId);
  await kit.run(60_000);
  expect(kit.events()).toMatchInlineSnapshot(`
    [
      {
        "at": "+31s",
        "kind": "finished",
        "reason": null,
        "run": "#1",
        "thread": "mcp:a",
      },
      {
        "at": "+31s",
        "kind": "finished",
        "reason": null,
        "run": "#1",
        "thread": "mcp:b",
      },
      {
        "at": "+32s",
        "kind": "finished",
        "reason": null,
        "run": "#1",
        "thread": "mcp:c",
      },
      {
        "at": "+32s",
        "kind": "finished",
        "reason": null,
        "run": "#1",
        "thread": "mcp:d",
      },
    ]
  `);
});

it('reports attention and completion on two threads at once, and needs_you once per pending set', async () => {
  launch('mcp:ask');
  launch('mcp:done');
  await kit.run(5000);
  Object.assign(kit.t3.get('mcp:ask'), { status: 'waiting', pendingRequestCount: 1 });
  kit.t3.finish('mcp:done');
  await kit.run(40_000);
  const together = kit.events();
  Object.assign(kit.t3.get('mcp:ask'), { status: 'running', pendingRequestCount: 0, itemCount: 7 });
  await kit.run(10_000);
  Object.assign(kit.t3.get('mcp:ask'), { status: 'waiting', pendingRequestCount: 1 });
  await kit.run(10_000);
  expect({ together, again: kit.events().slice(together.length) }).toMatchInlineSnapshot(`
    {
      "again": [
        {
          "at": "+61s",
          "kind": "needs_you",
          "reason": "1 pending request(s)",
          "run": "#1",
          "thread": "mcp:ask",
        },
      ],
      "together": [
        {
          "at": "+11s",
          "kind": "needs_you",
          "reason": "1 pending request(s)",
          "run": "#1",
          "thread": "mcp:ask",
        },
        {
          "at": "+31s",
          "kind": "finished",
          "reason": null,
          "run": "#1",
          "thread": "mcp:done",
        },
      ],
    }
  `);
});

it('reports an explicit failure of the watched run with its error, or its status when T3 gave none', async () => {
  launch('mcp:boom');
  launch('mcp:stopped');
  await kit.run(5000);
  kit.t3.finish('mcp:boom', 'failed', 'Provider exited with code 1');
  kit.t3.finish('mcp:stopped', 'cancelled');
  await kit.run(15_000);
  expect(kit.events()).toMatchInlineSnapshot(`
    [
      {
        "at": "+11s",
        "kind": "failed",
        "reason": "Provider exited with code 1",
        "run": "#1",
        "thread": "mcp:boom",
      },
      {
        "at": "+11s",
        "kind": "failed",
        "reason": "cancelled",
        "run": "#1",
        "thread": "mcp:stopped",
      },
    ]
  `);
});

it('goes degraded on schema drift and never finishes; missing background data ends idle_unverified', async () => {
  launch('mcp:drift');
  launch('mcp:old-t3');
  kit.t3.get('mcp:old-t3').omit.push('pendingBackgroundTasks', 'blockedOnThreadWait');
  await kit.run(5000);
  Object.assign(kit.t3.get('mcp:drift'), { status: 'paused', activeRunId: null });
  kit.t3.finish('mcp:old-t3');
  await kit.run(60_000);
  expect({ events: kit.events(), watches: kit.watches() }).toMatchInlineSnapshot(`
    {
      "events": [
        {
          "at": "+1s",
          "kind": "t3_degraded",
          "reason": "T3 does not report background work",
        },
        {
          "at": "+11s",
          "kind": "t3_degraded",
          "reason": "T3's output no longer matches: thread.status: Invalid option: expected one of "idle"|"preparing"|"queued"|"starting"|"running"|"waiting"|"completed"|"interrupted"|"failed"|"cancelled"|"rolled_back"",
        },
        {
          "at": "+31s",
          "kind": "idle_unverified",
          "reason": "T3 did not report background work",
          "run": "#1",
          "thread": "mcp:old-t3",
        },
      ],
      "watches": [
        {
          "reason": null,
          "run": "#1",
          "settled": false,
          "source": "registered",
          "state": "running",
          "thread": "mcp:drift",
        },
        {
          "reason": "T3 did not report background work",
          "run": "#1",
          "settled": false,
          "source": "registered",
          "state": "idle_unverified",
          "thread": "mcp:old-t3",
        },
      ],
    }
  `);
});
