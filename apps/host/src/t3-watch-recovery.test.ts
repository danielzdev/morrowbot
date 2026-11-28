import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ACKS_FILE, LEASE_MS } from './features/t3-watch/index.ts';
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
const handleLast = async (crash?: Crash): Promise<void> => {
  const batch = sink.sent.at(-1);
  if (batch === undefined) throw new Error('Nothing was sent');
  await receiver.handle(batch, crash);
  await kit.step();
};
const nextSend = async (ms = 2 * LEASE_MS): Promise<number> => {
  const count = sink.sent.length;
  await kit.until(() => sink.sent.length > count, ms);
  return seconds();
};
/** Each send as its time and its events (kind, thread, and whether it went out unverified). */
const timeline = (): string[] =>
  sink.sent.map(
    (batch) =>
      `+${String((Date.parse(batch.asOf) - START) / 1000)}s #${String(batch.attempt)} ${batch.events
        .map(({ event, unverified }) => `${event.kind}${event.scope === 'watch' ? `(${event.threadId})` : ''}${unverified ? ' UNVERIFIED' : ''}`)
        .join(', ')}`,
  );

it('keeps delivering other approvals past a thread it cannot read, sends that one unverified after three spaced deferrals, then once verified when it reads again', async () => {
  kit.t3.thread('mcp:dark', { status: 'waiting', pendingRequestCount: 1 });
  kit.register({ threadId: 'mcp:dark', runId: runOf('mcp:dark', 1) });
  kit.t3.thread('mcp:lit');
  kit.register({ threadId: 'mcp:lit', runId: runOf('mcp:lit', 1) });
  await kit.step();
  kit.t3.unreadable.add('mcp:dark');
  await kit.run(15_000);
  Object.assign(kit.t3.get('mcp:lit'), { status: 'waiting', pendingRequestCount: 1 });
  await nextSend();
  await handleLast();
  await nextSend();
  const notice = sink.sent.at(-1);
  const noticeId = notice?.events.find(({ unverified }) => unverified)?.event.eventId ?? '';
  await handleLast({ at: 'before_ack' });
  appendFileSync(path.join(kit.dir, ACKS_FILE), `${JSON.stringify({ batchId: notice?.batchId, deferredEventIds: [noticeId] })}\n`);
  await kit.step();
  const afterNoticeAck = { pending: kit.events(), dark: kit.watches().find((watch) => watch.thread === 'mcp:dark') };
  await kit.run(5 * 60_000);
  const whileStillDark = sink.sent.length;
  kit.t3.unreadable.delete('mcp:dark');
  await nextSend();
  await handleLast();
  await kit.run(10 * 60_000);
  expect({ timeline: timeline(), afterNoticeAck, whileStillDark, actions: receiver.actions, pending: kit.events() }).toMatchInlineSnapshot(`
    {
      "actions": [
        {
          "eventId": "id-4",
          "kind": "needs_you",
          "unverified": false,
        },
        {
          "eventId": "id-3",
          "kind": "needs_you",
          "unverified": true,
        },
        {
          "eventId": "id-7",
          "kind": "needs_you",
          "unverified": false,
        },
      ],
      "afterNoticeAck": {
        "dark": {
          "reason": null,
          "run": "#1",
          "settled": false,
          "source": "registered",
          "state": "needs_you",
          "thread": "mcp:dark",
        },
        "pending": [],
      },
      "pending": [],
      "timeline": [
        "+26s #1 needs_you(mcp:lit)",
        "+137s #1 needs_you(mcp:dark) UNVERIFIED",
        "+496s #1 needs_you(mcp:dark)",
      ],
      "whileStillDark": 2,
    }
  `);
});

it('recovers a finished that went out unverified: a verified finished follows once two reads confirm it, and the dedupe set does not suppress it', async () => {
  kit.t3.thread('mcp:done', { status: 'completed', activeRunId: null });
  kit.register({ threadId: 'mcp:done', runId: runOf('mcp:done', 1) });
  await kit.until(() => kit.events().length === 1);
  kit.t3.unreadable.add('mcp:done');
  await nextSend(3 * LEASE_MS);
  await handleLast();
  const afterNoticeAck = kit.watches();
  kit.t3.unreadable.delete('mcp:done');
  await nextSend();
  await handleLast();
  await kit.run(10 * 60_000);
  expect({ timeline: timeline(), afterNoticeAck, actions: receiver.actions, watches: kit.watches(), pending: kit.events() }).toMatchInlineSnapshot(`
    {
      "actions": [
        {
          "eventId": "id-2",
          "kind": "finished",
          "unverified": true,
        },
        {
          "eventId": "id-4",
          "kind": "finished",
          "unverified": false,
        },
      ],
      "afterNoticeAck": [
        {
          "reason": null,
          "run": "#1",
          "settled": false,
          "source": "registered",
          "state": "running",
          "thread": "mcp:done",
        },
      ],
      "pending": [],
      "timeline": [
        "+1299s #1 finished(mcp:done) UNVERIFIED",
        "+1387s #1 finished(mcp:done)",
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

it('never acts twice when a handling outlives its lease: the resend waits for the routine to go idle and handled.jsonl skips what was done', async () => {
  kit.t3.thread('mcp:ask', { status: 'waiting', pendingRequestCount: 1 });
  kit.register({ threadId: 'mcp:ask', runId: runOf('mcp:ask', 1) });
  kit.t3.thread('mcp:broke', { status: 'failed', activeRunId: null });
  kit.register({ threadId: 'mcp:broke', runId: runOf('mcp:broke', 1) });
  await nextSend();
  sink.running = true;
  const failed = sink.sent[0]?.events.at(-1)?.event.eventId;
  if (failed === undefined) throw new Error('Nothing was sent');
  await handleLast({ at: 'after_action', eventId: failed });
  await kit.run(LEASE_MS + 2 * 60_000);
  const sendsWhileRunning = sink.sent.length;
  sink.running = false;
  const resentAt = await nextSend();
  await handleLast();
  await kit.run(LEASE_MS + 60_000);
  expect({ sendsWhileRunning, resentAt, timeline: timeline(), counts: receiver.counts(), done: receiver.records().filter((record) => record.phase === 'done').length, pending: kit.events() }).toMatchInlineSnapshot(`
    {
      "counts": {
        "id-3": 1,
        "id-4": 1,
      },
      "done": 2,
      "pending": [],
      "resentAt": 734,
      "sendsWhileRunning": 1,
      "timeline": [
        "+7s #1 needs_you(mcp:ask), failed(mcp:broke)",
        "+734s #2 needs_you(mcp:ask), failed(mcp:broke)",
      ],
    }
  `);
});
