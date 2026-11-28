import { afterEach, beforeEach, expect, it } from 'vitest';
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
const handleLast = async (): Promise<void> => {
  const batch = sink.sent.at(-1);
  if (batch === undefined) throw new Error('Nothing was sent');
  await receiver.handle(batch);
  await kit.step();
};

it('sends a 4-thread finish burst as one batch once 25 s pass quietly, after a fresh read of each thread', async () => {
  for (const id of ['mcp:a', 'mcp:b', 'mcp:c', 'mcp:d']) watch(id);
  await kit.run(5000);
  for (const id of ['mcp:a', 'mcp:b', 'mcp:c', 'mcp:d']) {
    kit.t3.finish(id);
    await kit.run(2000);
  }
  await kit.until(() => kit.events().length === 4);
  const lastQueuedAt = seconds();
  const readsBefore = kit.t3.reads.length;
  await kit.until(() => sink.sent.length > 0);
  await kit.run(60_000);
  expect({ lastQueuedAt, sentAt: seconds() - 60, freshReads: kit.t3.reads.length - readsBefore, sent: kit.sent() }).toMatchInlineSnapshot(`
    {
      "freshReads": 4,
      "lastQueuedAt": 32,
      "sent": [
        {
          "asOf": "+59s",
          "attempt": 1,
          "batchId": "id-9",
          "events": [
            {
              "eventId": "id-5",
              "kind": "finished",
              "thread": "mcp:a",
            },
            {
              "eventId": "id-6",
              "kind": "finished",
              "thread": "mcp:b",
            },
            {
              "eventId": "id-7",
              "kind": "finished",
              "thread": "mcp:c",
            },
            {
              "eventId": "id-8",
              "kind": "finished",
              "thread": "mcp:d",
            },
          ],
          "status": [
            "mcp:a finished",
            "mcp:b finished",
            "mcp:c finished",
            "mcp:d finished",
          ],
        },
      ],
      "sentAt": 59,
    }
  `);
});

it('sends attention and completion together, needs_you first, 4 s after the request appears', async () => {
  watch('mcp:done');
  watch('mcp:ask');
  await kit.run(5000);
  kit.t3.finish('mcp:done');
  await kit.until(() => kit.events().length === 1);
  const finishedAt = seconds();
  Object.assign(kit.t3.get('mcp:ask'), { status: 'waiting', pendingRequestCount: 1 });
  await kit.until(() => kit.events().length === 2);
  const askedAt = seconds();
  await kit.until(() => sink.sent.length > 0);
  expect({ finishedAt, askedAt, sentAt: seconds(), sent: kit.sent() }).toMatchInlineSnapshot(`
    {
      "askedAt": 41,
      "finishedAt": 31,
      "sent": [
        {
          "asOf": "+46s",
          "attempt": 1,
          "batchId": "id-5",
          "events": [
            {
              "eventId": "id-4",
              "kind": "needs_you",
              "thread": "mcp:ask",
            },
            {
              "eventId": "id-3",
              "kind": "finished",
              "thread": "mcp:done",
            },
          ],
          "status": [
            "mcp:done finished",
            "mcp:ask needs_you",
          ],
        },
      ],
      "sentAt": 46,
    }
  `);
});

it('never lets a steady trickle of endings wait more than 45 s after the first', async () => {
  const ids = ['mcp:1', 'mcp:2', 'mcp:3', 'mcp:4', 'mcp:5', 'mcp:6'];
  for (const id of ids) watch(id, { status: 'completed', activeRunId: null, pendingBackgroundTasks: [{ taskId: 'helper', kind: 'subagent' }] });
  await kit.run(5000);
  for (const id of ids) {
    kit.t3.get(id).pendingBackgroundTasks = [];
    await kit.run(12_000);
  }
  await kit.until(() => sink.sent.length > 0);
  const sentAt = seconds();
  const inBatch = new Set(sink.sent.flatMap((batch) => batch.events.map(({ event }) => event.eventId)));
  const queuedAt = kit.service.pending().map((event) => ({ at: (Date.parse(event.at) - START) / 1000, inFirstBatch: inBatch.has(event.eventId) }));
  expect({ sentAt, queuedAt }).toMatchInlineSnapshot(`
    {
      "queuedAt": [
        {
          "at": 31,
          "inFirstBatch": true,
        },
        {
          "at": 41,
          "inFirstBatch": true,
        },
        {
          "at": 52,
          "inFirstBatch": true,
        },
        {
          "at": 62,
          "inFirstBatch": true,
        },
      ],
      "sentAt": 78,
    }
  `);
});

it('holds while the orchestrator is busy, sends 5 s after it goes idle, and keeps one batch in flight until its ack', async () => {
  watch('mcp:one');
  watch('mcp:two');
  sink.running = true;
  Object.assign(kit.t3.get('mcp:one'), { status: 'waiting', pendingRequestCount: 1 });
  await kit.run(60_000);
  const whileBusy = sink.sent.length;
  sink.running = false;
  await kit.until(() => sink.sent.length > 0);
  const idleAt = seconds();
  Object.assign(kit.t3.get('mcp:two'), { status: 'waiting', pendingRequestCount: 1 });
  await kit.run(60_000);
  const beforeAck = sink.sent.length;
  await handleLast();
  await kit.until(() => sink.sent.length > 1);
  expect({ whileBusy, idleAt, beforeAck, secondAt: seconds(), sent: kit.sent() }).toMatchInlineSnapshot(`
    {
      "beforeAck": 1,
      "idleAt": 67,
      "secondAt": 130,
      "sent": [
        {
          "asOf": "+67s",
          "attempt": 1,
          "batchId": "id-4",
          "events": [
            {
              "eventId": "id-3",
              "kind": "needs_you",
              "thread": "mcp:one",
            },
          ],
          "status": [
            "mcp:one needs_you",
            "mcp:two running",
          ],
        },
        {
          "asOf": "+130s",
          "attempt": 1,
          "batchId": "id-6",
          "events": [
            {
              "eventId": "id-5",
              "kind": "needs_you",
              "thread": "mcp:two",
            },
          ],
          "status": [
            "mcp:one needs_you",
            "mcp:two needs_you",
          ],
        },
      ],
      "whileBusy": 0,
    }
  `);
});

it('sends the batch as the design lays it out: frozen events, a status table, the receiver rules and both ack forms', async () => {
  watch('mcp:ask');
  Object.assign(kit.t3.get('mcp:ask'), { status: 'waiting', pendingRequestCount: 1 });
  await kit.until(() => sink.sent.length > 0);
  const [batch] = sink.sent;
  expect({ ...batch, rules: batch?.rules.map((rule) => rule.replaceAll(kit.dir, '<dir>')), ack: { ...batch?.ack, file: batch?.ack.file.replaceAll(kit.dir, '<dir>') } }).toMatchInlineSnapshot(`
    {
      "ack": {
        "api": "POST /api/t3-watches/acks {"batchId":"id-3","deferredEventIds":[],"goneEventIds":[]}",
        "file": "<dir>/acks.jsonl",
        "line": "{"batchId":"id-3","deferredEventIds":[],"goneEventIds":[]}",
      },
      "asOf": "2026-11-28T09:00:07.000Z",
      "attempt": 1,
      "batchId": "id-3",
      "events": [
        {
          "event": {
            "at": "2026-11-28T09:00:01.000Z",
            "eventId": "id-2",
            "fingerprint": "1@run:thread:mcp%3Aask:ordinal:1#3",
            "kind": "needs_you",
            "reason": "1 pending request(s)",
            "runId": "run:thread:mcp%3Aask:ordinal:1",
            "scope": "watch",
            "threadId": "mcp:ask",
            "watchId": "id-1",
          },
          "unverified": false,
        },
      ],
      "rules": [
        "Handle needs_you events first. The status table is context only: act only on entries in events.",
        "Skip any eventId that already has a done record in handled.jsonl. First rebuild goneEventIds from this batch’s done records with disposition gone.",
        "Before acting on a finished or needs_you event, run one fresh \`t3 thread show --json <threadId>\`.",
        "Act on finished only if that read shows the event's run completed, no newer run, no pending request and no background work, and <dir>/current-watches.json still maps the thread to the event's watchId. A different watchId: record stale, take no action. File unreadable: defer.",
        "Act on needs_you only if the same request is still pending; otherwise record stale.",
        "Two NotFound reads at least 5 s apart: record gone and list the eventId in goneEventIds. Any other failed or incomplete read: defer it (no done record) and list it in deferredEventIds.",
        "An event marked unverified: show it to the user as unconfirmed, take no action, record done (disposition unverified). Never revalidate or defer it.",
        "Append {"eventId","phase":"start"} to <dir>/handled.jsonl before acting, and {"eventId","batchId","phase":"done","disposition":"handled|stale|gone|unverified"} once the outcome is durable. A start without a done means a crash: check whether the action already happened before doing it again.",
        "Make every action retry-safe by eventId: a thread you start carries it in its title (\`t3 thread start --title "<label> [<eventId>]"\`, never --generate-title).",
        "Keep handling under 5 min: start long work as new T3 threads and register them.",
        "Ack only after every event is handled, suppressed or deferred, with one of the forms below.",
      ],
      "status": [
        {
          "label": null,
          "reason": null,
          "runId": "run:thread:mcp%3Aask:ordinal:1",
          "state": "needs_you",
          "threadId": "mcp:ask",
          "watchId": "id-1",
        },
      ],
    }
  `);
});

it('drops a finished that a fresh read contradicts, and the real finish later still goes out', async () => {
  watch('mcp:late-helper');
  await kit.run(5000);
  kit.t3.finish('mcp:late-helper');
  await kit.until(() => kit.events().length === 1);
  kit.t3.get('mcp:late-helper').pendingBackgroundTasks = [{ taskId: 'review', kind: 'subagent' }];
  await kit.run(40_000);
  const afterRevalidation = { sent: sink.sent.length, events: kit.events(), watches: kit.watches() };
  kit.t3.get('mcp:late-helper').pendingBackgroundTasks = [];
  await kit.until(() => sink.sent.length > 0);
  expect({ afterRevalidation, sentAt: seconds(), sent: kit.sent() }).toMatchInlineSnapshot(`
    {
      "afterRevalidation": {
        "events": [],
        "sent": 0,
        "watches": [
          {
            "reason": null,
            "run": "#1",
            "settled": false,
            "source": "registered",
            "state": "running",
            "thread": "mcp:late-helper",
          },
        ],
      },
      "sent": [
        {
          "asOf": "+123s",
          "attempt": 1,
          "batchId": "id-4",
          "events": [
            {
              "eventId": "id-3",
              "kind": "finished",
              "thread": "mcp:late-helper",
            },
          ],
          "status": [
            "mcp:late-helper finished",
          ],
        },
      ],
      "sentAt": 123,
    }
  `);
});
