import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ACKS_FILE, LEASE_MS } from './features/t3-watch/index.ts';
import { Receiver } from './testing/t3-receiver.ts';
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
const watch = (threadId: string, fields: Parameters<Kit['t3']['thread']>[1] = {}): void => {
  kit.t3.thread(threadId, fields);
  kit.register({ threadId, runId: runOf(threadId, 1) });
};
const finishing = (threadId: string): void => {
  watch(threadId, { status: 'completed', activeRunId: null });
};
const handleLast = async (): Promise<void> => {
  const batch = sink.sent.at(-1);
  if (batch === undefined) throw new Error('Nothing was sent');
  await receiver.handle(batch);
  await kit.step();
};
const nextSend = async (): Promise<number> => {
  const count = sink.sent.length;
  await kit.until(() => sink.sent.length > count, 2 * LEASE_MS);
  return seconds();
};

it('never settles a replacement watch on a late ack for the watch it replaced', async () => {
  watch('mcp:ask', { status: 'waiting', pendingRequestCount: 1 });
  await kit.until(() => sink.sent.length > 0);
  const replacement = kit.register({ threadId: 'mcp:ask', runId: runOf('mcp:ask', 1) });
  await handleLast();
  const afterLateAck = kit.watches();
  Object.assign(kit.t3.get('mcp:ask'), { status: 'completed', activeRunId: null, pendingRequestCount: 0, itemCount: 8 });
  await kit.until(() => sink.sent.length > 1);
  await handleLast();
  expect({ afterLateAck, settled: kit.watches(), pending: kit.events(), replacement: replacement.watchId, actions: receiver.actions.map((action) => action.kind) }).toMatchInlineSnapshot(`
    {
      "actions": [
        "needs_you",
        "finished",
      ],
      "afterLateAck": [
        {
          "reason": "replaced by id-4",
          "run": "#1",
          "settled": false,
          "source": "registered",
          "state": "superseded",
          "thread": "mcp:ask",
        },
        {
          "reason": null,
          "run": "#1",
          "settled": false,
          "source": "registered",
          "state": "needs_you",
          "thread": "mcp:ask",
        },
      ],
      "pending": [],
      "replacement": "id-4",
      "settled": [
        {
          "reason": "replaced by id-4",
          "run": "#1",
          "settled": false,
          "source": "registered",
          "state": "superseded",
          "thread": "mcp:ask",
        },
        {
          "reason": null,
          "run": "#1",
          "settled": true,
          "source": "registered",
          "state": "finished",
          "thread": "mcp:ask",
        },
      ],
    }
  `);
});

it('reports a send to a shared thread without a receipt as idle_unverified, settles it on the ack and reads it no more', async () => {
  kit.t3.thread('mcp:shared', { status: 'completed', activeRunId: null });
  kit.register({ threadId: 'mcp:shared', priorRunId: runOf('mcp:shared', 1) });
  await kit.until(() => sink.sent.length > 0);
  await handleLast();
  const readsAtAck = kit.t3.reads.length;
  await kit.run(120_000);
  expect({ sent: kit.sent(), watches: kit.watches(), pending: kit.events(), readsAfterAck: kit.t3.reads.length - readsAtAck }).toMatchInlineSnapshot(`
    {
      "pending": [],
      "readsAfterAck": 0,
      "sent": [
        {
          "asOf": "+46s",
          "attempt": 1,
          "batchId": "id-3",
          "events": [
            {
              "eventId": "id-2",
              "kind": "idle_unverified",
              "thread": "mcp:shared",
            },
          ],
          "status": [
            "mcp:shared idle_unverified",
          ],
        },
      ],
      "watches": [
        {
          "reason": "send to a shared thread without a run id",
          "run": null,
          "settled": true,
          "source": "registered",
          "state": "idle_unverified",
          "thread": "mcp:shared",
        },
      ],
    }
  `);
});

it('picks up after a host restart with a batch in flight: resent under the same ids, and an ack line in acks.jsonl settles it', async () => {
  finishing('mcp:done');
  await nextSend();
  kit.restart();
  const resentAt = await nextSend();
  const [first, second] = sink.sent;
  appendFileSync(path.join(kit.dir, ACKS_FILE), `{"batchId":"not-a-batch"}\nnot json\n${second?.ack.line ?? ''}\n`);
  await kit.step();
  await kit.run(LEASE_MS + 60_000);
  expect({
    resentAt,
    sameIds: first?.batchId === second?.batchId && JSON.stringify(first?.events) === JSON.stringify(second?.events),
    sends: sink.sent.length,
    watches: kit.watches(),
    warnings: kit.warnings,
  }).toMatchInlineSnapshot(`
    {
      "resentAt": 647,
      "sameIds": true,
      "sends": 2,
      "warnings": [
        "Skipped a malformed acks.jsonl line: not json",
        "Skipped an ack for unknown batch not-a-batch",
      ],
      "watches": [
        {
          "reason": null,
          "run": "#1",
          "settled": true,
          "source": "registered",
          "state": "finished",
          "thread": "mcp:done",
        },
      ],
    }
  `);
});

it('defers a queued finished whose fresh read lacks a signal, instead of dropping it as superseded', async () => {
  finishing('mcp:partial');
  await kit.until(() => kit.events().length === 1);
  const [queued] = kit.service.pending();
  kit.t3.get('mcp:partial').omit = ['pendingRequestCount'];
  await kit.run(40_000);
  const kept = kit.service.pending().some((event) => event.eventId === queued?.eventId);
  expect({ kept, sent: kit.sent(), watches: kit.watches().map((each) => each.state) }).toMatchInlineSnapshot(`
    {
      "kept": true,
      "sent": [
        {
          "asOf": "+47s",
          "attempt": 1,
          "batchId": "id-4",
          "events": [
            {
              "eventId": "id-3",
              "kind": "t3_degraded",
            },
          ],
          "status": [
            "mcp:partial finished",
          ],
        },
      ],
      "watches": [
        "finished",
      ],
    }
  `);
});

it('treats a deferral of an event the receiver never re-checks as a plain ack, with a warning', async () => {
  watch('mcp:broke', { status: 'failed', activeRunId: null });
  await nextSend();
  const batch = sink.sent[0];
  const failedId = batch?.events[0]?.event.eventId ?? '';
  appendFileSync(path.join(kit.dir, ACKS_FILE), `${JSON.stringify({ batchId: batch?.batchId, deferredEventIds: [failedId] })}\n`);
  await kit.step();
  await kit.run(LEASE_MS);
  expect({ sends: sink.sent.length, watches: kit.watches(), pending: kit.events(), warnings: kit.warnings }).toMatchInlineSnapshot(`
    {
      "pending": [],
      "sends": 1,
      "warnings": [
        "Ack for batch id-3 defers events that are never re-checked; taken as handled: id-2",
      ],
      "watches": [
        {
          "reason": "failed",
          "run": "#1",
          "settled": true,
          "source": "registered",
          "state": "failed",
          "thread": "mcp:broke",
        },
      ],
    }
  `);
});

it('keeps reading a thread the receiver called gone while the host still sees it, and its finished goes out again', async () => {
  finishing('mcp:ghost');
  await nextSend();
  const batch = sink.sent[0];
  appendFileSync(path.join(kit.dir, ACKS_FILE), `${JSON.stringify({ batchId: batch?.batchId, goneEventIds: [batch?.events[0]?.event.eventId] })}\n`);
  await kit.step();
  const resentAt = await nextSend();
  await handleLast();
  expect({ resentAt, sent: kit.sent(), watches: kit.watches(), pending: kit.events() }).toMatchInlineSnapshot(`
    {
      "pending": [],
      "resentAt": 95,
      "sent": [
        {
          "asOf": "+47s",
          "attempt": 1,
          "batchId": "id-3",
          "events": [
            {
              "eventId": "id-2",
              "kind": "finished",
              "thread": "mcp:ghost",
            },
          ],
          "status": [
            "mcp:ghost finished",
          ],
        },
        {
          "asOf": "+95s",
          "attempt": 1,
          "batchId": "id-5",
          "events": [
            {
              "eventId": "id-4",
              "kind": "finished",
              "thread": "mcp:ghost",
            },
          ],
          "status": [
            "mcp:ghost finished",
          ],
        },
      ],
      "watches": [
        {
          "reason": null,
          "run": "#1",
          "settled": true,
          "source": "registered",
          "state": "finished",
          "thread": "mcp:ghost",
        },
      ],
    }
  `);
});
