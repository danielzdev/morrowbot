import { afterEach, beforeEach, expect, it } from 'vitest';
import { runOf, START, startKit, type Kit } from './testing/t3-watch-kit.ts';

let kit: Kit;
beforeEach(async () => {
  kit = await startKit();
});
afterEach(async () => {
  expect(kit.errors).toEqual([]);
  await kit.close();
});

it('adopts a run that started and ended before the first read when the thread was created after launch, and finishes it', async () => {
  const launchedAt = new Date(START).toISOString();
  kit.clock.at += 1000;
  kit.t3.thread('mcp:quick', { status: 'completed', activeRunId: null, createdAt: new Date(START + 500).toISOString() });
  kit.clock.at += 4000;
  kit.register({ threadId: 'mcp:quick', launchedAt, label: 'quick' });
  await kit.run(30_000);
  expect(kit.watches()).toMatchInlineSnapshot(`
    [
      {
        "reason": null,
        "run": "#1",
        "settled": false,
        "source": "registered",
        "state": "finished",
        "thread": "mcp:quick",
      },
    ]
  `);
  expect(kit.events()).toMatchInlineSnapshot(`
    [
      {
        "at": "+26s",
        "kind": "finished",
        "reason": null,
        "run": "#1",
        "thread": "mcp:quick",
      },
    ]
  `);
});

it('never adopts the first run of a thread that existed before launch', async () => {
  kit.t3.thread('mcp:old', { status: 'completed', activeRunId: null, createdAt: new Date(START - 60_000).toISOString() });
  kit.register({ threadId: 'mcp:old' });
  await kit.run(30_000);
  expect(kit.events()).toMatchInlineSnapshot(`
    [
      {
        "at": "+21s",
        "kind": "idle_unverified",
        "reason": "thread existed before launch",
        "run": null,
        "thread": "mcp:old",
      },
    ]
  `);
});

it('does not adopt the busy run a send queued behind, and finishes the queued run once it is done', async () => {
  kit.t3.thread('mcp:busy', { latestRunId: runOf('mcp:busy', 3), activeRunId: runOf('mcp:busy', 3) });
  kit.register({ threadId: 'mcp:busy', priorRunId: runOf('mcp:busy', 3), exclusive: true, label: 'exclusive send' });
  kit.register({ threadId: 'mcp:direct', runId: runOf('mcp:direct', 4), label: 'send --json' });
  kit.t3.thread('mcp:direct', { latestRunId: runOf('mcp:direct', 3), activeRunId: runOf('mcp:direct', 3) });
  await kit.run(30_000);
  const busy = kit.watches();
  kit.t3.finish('mcp:busy');
  kit.t3.finish('mcp:direct');
  await kit.run(10_000);
  const between = kit.watches();
  kit.t3.startRun('mcp:busy', 4);
  kit.t3.startRun('mcp:direct', 4);
  await kit.run(20_000);
  kit.t3.finish('mcp:busy');
  kit.t3.finish('mcp:direct');
  await kit.run(30_000);
  expect({ busy, between, after: kit.watches(), events: kit.events() }).toMatchInlineSnapshot(`
    {
      "after": [
        {
          "reason": null,
          "run": "#4",
          "settled": false,
          "source": "registered",
          "state": "finished",
          "thread": "mcp:busy",
        },
        {
          "reason": null,
          "run": "#4",
          "settled": false,
          "source": "registered",
          "state": "finished",
          "thread": "mcp:direct",
        },
      ],
      "between": [
        {
          "reason": null,
          "run": null,
          "settled": false,
          "source": "registered",
          "state": "running",
          "thread": "mcp:busy",
        },
        {
          "reason": null,
          "run": "#4",
          "settled": false,
          "source": "registered",
          "state": "running",
          "thread": "mcp:direct",
        },
      ],
      "busy": [
        {
          "reason": null,
          "run": null,
          "settled": false,
          "source": "registered",
          "state": "running",
          "thread": "mcp:busy",
        },
        {
          "reason": null,
          "run": "#4",
          "settled": false,
          "source": "registered",
          "state": "running",
          "thread": "mcp:direct",
        },
      ],
      "events": [
        {
          "at": "+81s",
          "kind": "finished",
          "reason": null,
          "run": "#4",
          "thread": "mcp:busy",
        },
        {
          "at": "+81s",
          "kind": "finished",
          "reason": null,
          "run": "#4",
          "thread": "mcp:direct",
        },
      ],
    }
  `);
});

it('reports an idle thread with no new run as watch_missing (no_run), never finished', async () => {
  kit.t3.thread('mcp:idle', { status: 'completed', latestRunId: runOf('mcp:idle', 2), activeRunId: null });
  kit.register({ threadId: 'mcp:idle', priorRunId: runOf('mcp:idle', 2), exclusive: true });
  await kit.run(40_000);
  expect(kit.events()).toMatchInlineSnapshot(`
    [
      {
        "at": "+21s",
        "kind": "watch_missing",
        "reason": "no_run",
        "run": null,
        "thread": "mcp:idle",
      },
    ]
  `);
});

it('leaves a send to a shared thread without a run id unbound, ending idle_unverified', async () => {
  kit.t3.thread('mcp:shared', { latestRunId: runOf('mcp:shared', 5), activeRunId: runOf('mcp:shared', 5) });
  kit.register({ threadId: 'mcp:shared', priorRunId: runOf('mcp:shared', 4) });
  await kit.run(20_000);
  kit.t3.finish('mcp:shared');
  await kit.run(30_000);
  expect(kit.events()).toMatchInlineSnapshot(`
    [
      {
        "at": "+41s",
        "kind": "idle_unverified",
        "reason": "send to a shared thread without a run id",
        "run": null,
        "thread": "mcp:shared",
      },
    ]
  `);
});

it('cannot tell which run is ours when more than one ran since the prior run, so it ends idle_unverified', async () => {
  kit.t3.thread('mcp:two', { status: 'completed', latestRunId: runOf('mcp:two', 4), activeRunId: null });
  kit.register({ threadId: 'mcp:two', priorRunId: runOf('mcp:two', 2), exclusive: true });
  await kit.run(30_000);
  expect(kit.events()).toMatchInlineSnapshot(`
    [
      {
        "at": "+21s",
        "kind": "idle_unverified",
        "reason": "more than one run since launch",
        "run": null,
        "thread": "mcp:two",
      },
    ]
  `);
});
