import { afterEach, beforeEach, expect, it } from 'vitest';
import { LEASE_MS } from './features/t3-watch/index.ts';
import { Receiver, type Crash } from './testing/t3-receiver.ts';
import { runOf, START, startKit, type FakeSink, type Kit } from './testing/t3-watch-kit.ts';

let kit: Kit;
let sink: FakeSink;
let receiver: Receiver;
beforeEach(async () => {
  kit = await startKit({ delivery: true });
  if (kit.sink === null) throw new Error('No sink');
  sink = kit.sink;
  receiver = new Receiver(kit.dir, kit.t3, (ms) => {
    kit.clock.at += ms;
  });
});
afterEach(async () => {
  expect(kit.errors).toEqual([]);
  await kit.close();
});

const seconds = (): number => (kit.clock.now() - START) / 1000;
const ask = (threadId: string): void => {
  kit.t3.thread(threadId, { status: 'waiting', pendingRequestCount: 1 });
  kit.register({ threadId, runId: runOf(threadId, 1) });
};
const finishing = (threadId: string): void => {
  kit.t3.thread(threadId, { status: 'completed', activeRunId: null });
  kit.register({ threadId, runId: runOf(threadId, 1) });
};
const handleLast = async (crash?: Crash): Promise<'acked' | 'crashed'> => {
  const batch = sink.sent.at(-1);
  if (batch === undefined) throw new Error('Nothing was sent');
  const outcome = await receiver.handle(batch, crash);
  await kit.step();
  return outcome;
};
const nextSend = async (): Promise<number> => {
  const count = sink.sent.length;
  await kit.until(() => sink.sent.length > count, 2 * LEASE_MS);
  return seconds();
};

it('resends a batch that was taken but never acked exactly once, after its lease, with the same ids and a fresh status table', async () => {
  ask('mcp:ask');
  const firstAt = await nextSend();
  expect(await handleLast({ at: 'before_ack' })).toBe('crashed');
  kit.t3.thread('mcp:other');
  kit.register({ threadId: 'mcp:other', runId: runOf('mcp:other', 1), stallAfterMin: 120 });
  const resentAt = await nextSend();
  await handleLast();
  await kit.run(2 * LEASE_MS);
  expect({ firstAt, resentAt, sends: kit.sent(), actions: receiver.counts(), pending: kit.events(), watches: kit.watches().map((watch) => `${watch.thread} ${watch.state}`) }).toMatchInlineSnapshot(`
    {
      "actions": {
        "id-2": 1,
      },
      "firstAt": 7,
      "pending": [],
      "resentAt": 607,
      "sends": [
        {
          "asOf": "+7s",
          "attempt": 1,
          "batchId": "id-3",
          "events": [
            {
              "eventId": "id-2",
              "kind": "needs_you",
              "thread": "mcp:ask",
            },
          ],
          "status": [
            "mcp:ask needs_you",
          ],
        },
        {
          "asOf": "+607s",
          "attempt": 2,
          "batchId": "id-3",
          "events": [
            {
              "eventId": "id-2",
              "kind": "needs_you",
              "thread": "mcp:ask",
            },
          ],
          "status": [
            "mcp:ask needs_you",
            "mcp:other running",
          ],
        },
      ],
      "watches": [
        "mcp:ask needs_you",
        "mcp:other running",
      ],
    }
  `);
});

it('handles a batch the receiver never got to on the resend, with no new event', async () => {
  ask('mcp:ask');
  await nextSend();
  await nextSend();
  await handleLast();
  await kit.run(LEASE_MS + 60_000);
  expect({ sends: kit.sent().length, events: sink.sent.map((batch) => batch.events.map(({ event }) => event.eventId)), actions: receiver.counts(), pending: kit.events() }).toMatchInlineSnapshot(`
    {
      "actions": {
        "id-2": 1,
      },
      "events": [
        [
          "id-2",
        ],
        [
          "id-2",
        ],
      ],
      "pending": [],
      "sends": 2,
    }
  `);
});

it('gives each event exactly one durable outcome when the receiver crashes after start, and again after the action', async () => {
  kit.t3.thread('mcp:ask');
  kit.register({ threadId: 'mcp:ask', runId: runOf('mcp:ask', 1) });
  kit.t3.thread('mcp:broke');
  kit.register({ threadId: 'mcp:broke', runId: runOf('mcp:broke', 1) });
  await kit.run(3000);
  Object.assign(kit.t3.get('mcp:ask'), { status: 'waiting', pendingRequestCount: 1 });
  kit.t3.finish('mcp:broke', 'failed', 'Provider exited with code 1');
  await nextSend();
  const [needsYou, failed] = sink.sent[0]?.events.map(({ event }) => event.eventId) ?? [];
  if (needsYou === undefined || failed === undefined) throw new Error('Expected both events in one batch');
  await handleLast({ at: 'after_start', eventId: needsYou });
  await nextSend();
  await handleLast({ at: 'after_action', eventId: failed });
  await nextSend();
  const last = await handleLast();
  const done = receiver.records().filter((record) => record.phase === 'done');
  expect({ last, sends: sink.sent.length, actions: receiver.counts(), done: done.map((record) => record.eventId), pending: kit.events() }).toMatchInlineSnapshot(`
    {
      "actions": {
        "id-3": 1,
        "id-4": 1,
      },
      "done": [
        "id-3",
        "id-4",
      ],
      "last": "acked",
      "pending": [],
      "sends": 3,
    }
  `);
});

it('partially acks a batch whose fresh read failed, retries that event after 1 min and handles it once T3 answers', async () => {
  ask('mcp:flaky');
  ask('mcp:steady');
  const firstAt = await nextSend();
  kit.t3.unreadable.add('mcp:flaky');
  await handleLast();
  const afterPartialAck = { pending: kit.events(), watches: kit.watches().map((watch) => `${watch.thread} ${watch.state} settled=${String(watch.settled)}`) };
  kit.t3.unreadable.delete('mcp:flaky');
  const retriedAt = await nextSend();
  await handleLast();
  expect({ firstAt, afterPartialAck, retriedAt, sends: kit.sent(), actions: receiver.counts(), pending: kit.events() }).toMatchInlineSnapshot(`
    {
      "actions": {
        "id-3": 1,
        "id-4": 1,
      },
      "afterPartialAck": {
        "pending": [
          {
            "at": "+1s",
            "kind": "needs_you",
            "reason": "1 pending request(s)",
            "run": "#1",
            "thread": "mcp:flaky",
          },
        ],
        "watches": [
          "mcp:flaky needs_you settled=false",
          "mcp:steady needs_you settled=false",
        ],
      },
      "firstAt": 7,
      "pending": [],
      "retriedAt": 73,
      "sends": [
        {
          "asOf": "+7s",
          "attempt": 1,
          "batchId": "id-5",
          "events": [
            {
              "eventId": "id-3",
              "kind": "needs_you",
              "thread": "mcp:flaky",
            },
            {
              "eventId": "id-4",
              "kind": "needs_you",
              "thread": "mcp:steady",
            },
          ],
          "status": [
            "mcp:flaky needs_you",
            "mcp:steady needs_you",
          ],
        },
        {
          "asOf": "+73s",
          "attempt": 1,
          "batchId": "id-6",
          "events": [
            {
              "eventId": "id-3",
              "kind": "needs_you",
              "thread": "mcp:flaky",
            },
          ],
          "status": [
            "mcp:flaky needs_you",
            "mcp:steady needs_you",
          ],
        },
      ],
    }
  `);
});

it('lists a deleted thread in goneEventIds, keeps its watch unsettled until the host sees watch_missing, and rebuilds the list after a crash before the ack', async () => {
  finishing('mcp:gone');
  await nextSend();
  kit.t3.threads.delete('mcp:gone');
  await handleLast({ at: 'before_ack' });
  const recorded = receiver.records();
  await nextSend();
  await handleLast();
  const afterGoneAck = kit.watches();
  await nextSend();
  await handleLast();
  expect({ recorded, afterGoneAck, sends: kit.sent(), actions: receiver.counts(), watches: kit.watches(), pending: kit.events() }).toMatchInlineSnapshot(`
    {
      "actions": {
        "id-4": 1,
      },
      "afterGoneAck": [
        {
          "reason": null,
          "run": "#1",
          "settled": false,
          "source": "registered",
          "state": "running",
          "thread": "mcp:gone",
        },
      ],
      "pending": [],
      "recorded": [
        {
          "batchId": "id-3",
          "disposition": "gone",
          "eventId": "id-2",
          "phase": "done",
        },
      ],
      "sends": [
        {
          "asOf": "+47s",
          "attempt": 1,
          "batchId": "id-3",
          "events": [
            {
              "eventId": "id-2",
              "kind": "finished",
              "thread": "mcp:gone",
            },
          ],
          "status": [
            "mcp:gone finished",
          ],
        },
        {
          "asOf": "+647s",
          "attempt": 2,
          "batchId": "id-3",
          "events": [
            {
              "eventId": "id-2",
              "kind": "finished",
              "thread": "mcp:gone",
            },
          ],
          "status": [
            "mcp:gone finished",
          ],
        },
        {
          "asOf": "+684s",
          "attempt": 1,
          "batchId": "id-5",
          "events": [
            {
              "eventId": "id-4",
              "kind": "watch_missing",
              "thread": "mcp:gone",
            },
          ],
          "status": [
            "mcp:gone watch_missing",
          ],
        },
      ],
      "watches": [
        {
          "reason": "not_found",
          "run": "#1",
          "settled": true,
          "source": "registered",
          "state": "watch_missing",
          "thread": "mcp:gone",
        },
      ],
    }
  `);
});

it('records a superseded watch’s finished as stale without acting, and defers it while current-watches.json is unreadable', async () => {
  finishing('mcp:redo');
  await nextSend();
  kit.t3.thread('mcp:redo', { status: 'completed', activeRunId: null });
  kit.register({ threadId: 'mcp:redo', runId: runOf('mcp:redo', 2) });
  await handleLast();
  kit.t3.startRun('mcp:redo', 2);
  const stale = receiver.records().at(-1);
  finishing('mcp:locked');
  await nextSend();
  receiver.currentWatchesUnreadable = true;
  await handleLast();
  const deferred = kit.service.pending().map((event) => event.eventId);
  receiver.currentWatchesUnreadable = false;
  const retriedAt = await nextSend();
  await handleLast();
  expect({ stale, deferred, retriedAt, actions: receiver.actions.map((action) => action.kind), sends: kit.sent().length, pending: kit.events() }).toMatchInlineSnapshot(`
    {
      "actions": [
        "finished",
      ],
      "deferred": [
        "id-6",
      ],
      "pending": [],
      "retriedAt": 722,
      "sends": 3,
      "stale": {
        "batchId": "id-3",
        "disposition": "stale",
        "eventId": "id-2",
        "phase": "done",
      },
    }
  `);
});
