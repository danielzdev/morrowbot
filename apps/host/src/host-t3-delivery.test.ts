import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MessageList, Routine, RoutineList, T3WatchBatch, T3WatchList, type RoutineRun } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';
import { sequence, type Sequence } from './testing/test-host.ts';
import type { T3WatchClock } from './features/t3-watch/index.ts';
import { FakeT3, runOf, START } from './testing/t3-watch-kit.ts';

/** The watcher's clock, moved by hand; each second runs the watcher's tick as its timer would. */
class TickingClock implements T3WatchClock {
  at = START;
  private tick: () => void = () => undefined;
  now(): number {
    return this.at;
  }
  every(_ms: number, tick: () => void): () => void {
    this.tick = tick;
    return () => {
      this.tick = () => undefined;
    };
  }
  async advance(ms: number): Promise<void> {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
      this.at += 1000;
      this.tick();
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}

let dataDir: string;
let ids: Sequence;
let fixture: ChatFixture | undefined;
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'morrowbot-t3-delivery-'));
  ids = sequence();
});
afterEach(async () => {
  if (fixture !== undefined) {
    await fixture.close();
    expect(fixture.host.errors).toEqual([]);
    fixture = undefined;
  }
  await rm(dataDir, { recursive: true, force: true });
});

async function lastRun(host: ChatFixture['host'], routineId: string): Promise<RoutineRun | null> {
  const { routines } = RoutineList.parse((await host.call('GET', '/api/routines')).body);
  return routines.find((routine) => routine.id === routineId)?.lastRun ?? null;
}

async function settledRun(host: ChatFixture['host'], routineId: string): Promise<RoutineRun> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const run = await lastRun(host, routineId);
    if (run !== null && run.result.kind !== 'running') return run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('The routine run did not finish');
}

it('delivers one batch to the orchestrator’s own routine, never its chat, held while the user’s turn runs and sent 5 s after it ends', async () => {
  const clock = new TickingClock();
  const t3 = new FakeT3(clock);
  const setup = await startChatFixture({ dataDir, sequence: ids, t3Watch: { probe: t3, clock } });
  const agent = await setup.agent();
  const created = await setup.host.call('POST', '/api/routines', { agentId: agent.id, title: 'T3 updates', instruction: 'Handle this T3 watch batch.', schedule: { kind: 'manual' } });
  const routine = Routine.parse(created.body);
  await setup.close();
  const host = (fixture = await startChatFixture({ dataDir, sequence: ids, t3Watch: { probe: t3, clock }, t3RoutineId: routine.id })).host;
  const chat = await fixture.thread(agent, 'Orchestrator');

  t3.thread('mcp:ask', { status: 'waiting', pendingRequestCount: 1 });
  t3.thread('mcp:done', { status: 'completed', activeRunId: null });
  for (const threadId of ['mcp:ask', 'mcp:done']) {
    await host.call('POST', '/api/t3-watches', { threadId, launchedAt: new Date(START).toISOString(), runId: runOf(threadId, 1) });
  }
  const typing = await host.call('POST', `/api/threads/${chat.id}/messages`, { text: 'stall-polite', sessionChoice: { kind: 'auto' } });
  await clock.advance(60_000);
  const runWhileTyping = await lastRun(host, routine.id);
  await host.call('POST', `/api/threads/${chat.id}/stop`);
  await clock.advance(4000);
  const runAfter4s = await lastRun(host, routine.id);
  await clock.advance(3000);
  const run = await settledRun(host, routine.id);

  const prompt = MessageList.parse((await host.call('GET', `/api/threads/${run.threadId ?? ''}/messages`)).body).messages[0]?.text ?? '';
  const batch = T3WatchBatch.parse(JSON.parse(/```json\n([\s\S]*)\n```/.exec(prompt)?.[1] ?? 'null'));
  const acked = await host.call('POST', '/api/t3-watches/acks', { batchId: batch.batchId });
  const again = await host.call('POST', '/api/t3-watches/acks', { batchId: batch.batchId });
  const unknown = await host.call('POST', '/api/t3-watches/acks', { batchId: 'no-such-batch' });
  const malformed = await host.call('POST', '/api/t3-watches/acks', { batchId: batch.batchId, deferredEventIds: 'all' });
  await clock.advance(60_000);
  const { watches } = T3WatchList.parse((await host.call('GET', '/api/t3-watches')).body);
  expect({
    typing: typing.status,
    runWhileTyping,
    runAfter4s,
    run: { trigger: run.trigger, result: run.result.kind, ownChat: run.threadId !== chat.id },
    prompt: prompt.split('\n')[0],
    events: batch.events.map(({ event, unverified }) => `${event.kind} ${event.scope === 'watch' ? event.threadId : ''} unverified=${String(unverified)}`),
    replies: [acked, again, unknown, malformed.status],
    watches: watches.map((watch) => `${watch.threadId} ${watch.state} settled=${String(watch.settledAt !== null)}`),
    userChat: await fixture.history(chat),
    noSecondRun: (await lastRun(host, routine.id))?.id === run.id,
  }).toMatchInlineSnapshot(`
    {
      "events": [
        "needs_you mcp:ask unverified=false",
        "finished mcp:done unverified=false",
      ],
      "noSecondRun": true,
      "prompt": "Handle this T3 watch batch.",
      "replies": [
        {
          "body": {
            "result": "acked",
          },
          "status": 200,
        },
        {
          "body": {
            "result": "already_acked",
          },
          "status": 200,
        },
        {
          "body": {
            "error": {
              "kind": "not_found",
              "message": "T3 watch batch not found",
            },
          },
          "status": 404,
        },
        400,
      ],
      "run": {
        "ownChat": true,
        "result": "posted",
        "trigger": "wake",
      },
      "runAfter4s": null,
      "runWhileTyping": null,
      "typing": 202,
      "userChat": [
        "user: stall-polite",
        "assistant(cancelled): hello from pid <pid>:",
      ],
      "watches": [
        "mcp:done finished settled=true",
        "mcp:ask needs_you settled=false",
      ],
    }
  `);
});
