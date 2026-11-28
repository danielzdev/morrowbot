import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runOf, startKit, type Kit } from './testing/t3-watch-kit.ts';

let kit: Kit | undefined;
afterEach(async () => {
  if (kit === undefined) return;
  expect(kit.errors).toEqual([]);
  await kit.close();
  kit = undefined;
});

async function start(projects: readonly string[] = []): Promise<Kit> {
  kit = await startKit({ projects });
  mkdirSync(kit.dir, { recursive: true });
  return kit;
}

const request = (fixture: Kit, threadId: string): string =>
  JSON.stringify({ threadId, launchedAt: new Date(fixture.clock.now()).toISOString(), runId: runOf(threadId, 1) });

it('registers complete requests.jsonl lines once, skipping malformed ones and waiting for an unfinished one', async () => {
  const fixture = await start();
  const file = path.join(fixture.dir, 'requests.jsonl');
  for (const threadId of ['mcp:a', 'mcp:b', 'mcp:c', 'mcp:d']) fixture.t3.thread(threadId);
  appendFileSync(file, `${request(fixture, 'mcp:a')}\nnot json\n{"threadId":"mcp:x"}\n${request(fixture, 'mcp:b').slice(0, 20)}`);
  await fixture.step();
  const firstPass = fixture.watches();
  appendFileSync(file, `${request(fixture, 'mcp:b').slice(20)}\n`);
  await fixture.step();
  await fixture.step();
  const threads = fixture.watches();
  rmSync(file);
  writeFileSync(file, `${request(fixture, 'mcp:c')}\n`);
  await fixture.step();
  writeFileSync(file, '');
  await fixture.step();
  appendFileSync(file, `${request(fixture, 'mcp:d')}\n`);
  await fixture.step();
  expect({
    firstPass: firstPass.length,
    threads: threads.map((watch) => watch.thread),
    replacedAndTruncated: fixture.watches().map((watch) => watch.thread),
    warnings: fixture.warnings,
  }).toMatchInlineSnapshot(`
    {
      "firstPass": 1,
      "replacedAndTruncated": [
        "mcp:a",
        "mcp:b",
        "mcp:c",
        "mcp:d",
      ],
      "threads": [
        "mcp:a",
        "mcp:b",
      ],
      "warnings": [
        "Skipped a malformed requests.jsonl line: not json",
        "Skipped a malformed requests.jsonl line: {"threadId":"mcp:x"}",
      ],
    }
  `);
});

it('keeps current-watches.json naming each thread’s current watch, rewritten whole', async () => {
  const fixture = await start();
  fixture.t3.thread('mcp:a');
  fixture.t3.thread('mcp:b');
  const a1 = fixture.register({ threadId: 'mcp:a', runId: runOf('mcp:a', 1) });
  const b = fixture.register({ threadId: 'mcp:b', runId: runOf('mcp:b', 1) });
  const a2 = fixture.register({ threadId: 'mcp:a', runId: runOf('mcp:a', 2) });
  const read = (): unknown => JSON.parse(readFileSync(path.join(fixture.dir, 'current-watches.json'), 'utf8'));
  const afterRegistering = read();
  fixture.service.remove(b.watchId);
  expect({ a1: a1.watchId, a2: a2.watchId, b: b.watchId, afterRegistering, afterRemoving: read() }).toMatchInlineSnapshot(`
    {
      "a1": "id-1",
      "a2": "id-3",
      "afterRegistering": {
        "threads": {
          "mcp:a": "id-3",
          "mcp:b": "id-2",
        },
      },
      "afterRemoving": {
        "threads": {
          "mcp:a": "id-3",
        },
      },
      "b": "id-2",
    }
  `);
});

it('discovers running threads every 30 s without overwriting a registered watch', async () => {
  const fixture = await start(['project-1']);
  fixture.t3.thread('mcp:mine');
  fixture.t3.thread('mcp:found');
  fixture.t3.thread('mcp:idle', { status: 'completed', activeRunId: null });
  fixture.t3.projects.set('project-1', ['mcp:mine', 'mcp:found', 'mcp:idle']);
  fixture.register({ threadId: 'mcp:mine', runId: runOf('mcp:mine', 1), label: 'mine' });
  await fixture.run(29_000);
  const listsIn29s = fixture.t3.lists.length;
  await fixture.run(2000);
  expect({ listsIn29s, listsIn31s: fixture.t3.lists.length, watches: fixture.watches() }).toMatchInlineSnapshot(`
    {
      "listsIn29s": 1,
      "listsIn31s": 2,
      "watches": [
        {
          "reason": null,
          "run": "#1",
          "settled": false,
          "source": "registered",
          "state": "running",
          "thread": "mcp:mine",
        },
        {
          "reason": null,
          "run": "#1",
          "settled": false,
          "source": "discovered",
          "state": "running",
          "thread": "mcp:found",
        },
      ],
    }
  `);
});

it('reads nothing while no watch is open, and keeps to two reads in flight and two started per second', async () => {
  const fixture = await start();
  await fixture.run(60_000);
  const idleReads = fixture.t3.reads.length;
  const threads = ['mcp:1', 'mcp:2', 'mcp:3', 'mcp:4', 'mcp:5', 'mcp:6'];
  for (const threadId of threads) {
    fixture.t3.thread(threadId);
    fixture.register({ threadId, runId: runOf(threadId, 1) });
  }
  fixture.t3.holding = true;
  for (let tick = 0; tick < 3; tick += 1) {
    fixture.clock.at += 1000;
    fixture.service.tick();
  }
  const heldAfterThreeTicks = { inFlight: fixture.t3.inFlight, started: fixture.t3.reads.length };
  fixture.t3.holding = false;
  fixture.t3.release();
  await fixture.service.idle();
  await fixture.run(30_000);
  const perSecond = new Map<number, number>();
  for (const { at } of fixture.t3.reads) perSecond.set(Math.floor(at / 1000), (perSecond.get(Math.floor(at / 1000)) ?? 0) + 1);
  const perThread = threads.map((threadId) => fixture.t3.reads.filter((read) => read.threadId === threadId).length);
  expect({ idleReads, heldAfterThreeTicks, maxInFlight: fixture.t3.maxInFlight, maxPerSecond: Math.max(...perSecond.values()), perThread }).toMatchInlineSnapshot(`
    {
      "heldAfterThreeTicks": {
        "inFlight": 2,
        "started": 2,
      },
      "idleReads": 0,
      "maxInFlight": 2,
      "maxPerSecond": 2,
      "perThread": [
        4,
        4,
        3,
        3,
        3,
        3,
      ],
    }
  `);
});
