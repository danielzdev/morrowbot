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
  async advance(ms: number, settle: () => Promise<void>): Promise<void> {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
      this.at += 1000;
      this.tick();
      await settle();
    }
  }
}

let dataDir: string;
let ids: Sequence;
let fixture: ChatFixture | undefined;
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'oribot-t3-delivery-'));
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

it('delivers one batch to the orchestrator’s own routine, held while the user’s turn runs and sent 5 s after it ends, and posts the report to the agent’s main chat', async () => {
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
  const settle = () => host.host.t3Watches.idle();
  const typing = await host.call('POST', `/api/threads/${chat.id}/messages`, { text: 'stall-polite', sessionChoice: { kind: 'auto' } });
  await clock.advance(60_000, settle);
  const runWhileTyping = await lastRun(host, routine.id);
  await host.call('POST', `/api/threads/${chat.id}/stop`);
  await clock.advance(4000, settle);
  const runAfter4s = await lastRun(host, routine.id);
  await clock.advance(3000, settle);
  const run = await settledRun(host, routine.id);

  const prompt = MessageList.parse((await host.call('GET', `/api/threads/${run.threadId ?? ''}/messages`)).body).messages[0]?.text ?? '';
  const batch = T3WatchBatch.parse(JSON.parse(/```json\n([\s\S]*)\n```/.exec(prompt)?.[1] ?? 'null'));
  const acked = await host.call('POST', '/api/t3-watches/acks', { batchId: batch.batchId });
  const again = await host.call('POST', '/api/t3-watches/acks', { batchId: batch.batchId });
  const unknown = await host.call('POST', '/api/t3-watches/acks', { batchId: 'no-such-batch' });
  const malformed = await host.call('POST', '/api/t3-watches/acks', { batchId: batch.batchId, deferredEventIds: 'all' });
  await clock.advance(60_000, settle);
  const { watches } = T3WatchList.parse((await host.call('GET', '/api/t3-watches')).body);
  const livePosted = fixture.events.received.filter((event) => event.kind === 'message.posted' && event.threadId === chat.id);
  expect({
    typing: typing.status,
    runWhileTyping,
    runAfter4s,
    run: { trigger: run.trigger, result: run.result.kind, ownChat: run.threadId !== chat.id },
    prompt: prompt.split('\n')[0],
    events: batch.events.map(({ event, unverified }) => `${event.kind} ${event.scope === 'watch' ? event.threadId : ''} unverified=${String(unverified)}`),
    replies: [acked, again, unknown, malformed.status],
    watches: watches.map((watch) => `${watch.threadId} ${watch.state} settled=${String(watch.settledAt !== null)}`),
    userChat: (await fixture.history(chat)).map((line) => line.split('\n')[0]),
    livePostedCount: livePosted.length,
    noSecondRun: (await lastRun(host, routine.id))?.id === run.id,
  }).toMatchInlineSnapshot(`
    {
      "events": [
        "needs_you mcp:ask unverified=false",
        "finished mcp:done unverified=false",
      ],
      "livePostedCount": 1,
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
        "assistant(completed): hello from pid <pid>: Handle this T3 watch batch.",
      ],
      "watches": [
        "mcp:done finished settled=true",
        "mcp:ask needs_you settled=false",
      ],
    }
  `);
});

it('delivers watch reports to the creating chat (not another chat) and falls back to the main chat when the creating chat is archived', async () => {
  const clock = new TickingClock();
  const t3 = new FakeT3(clock);
  fixture = await startChatFixture({ dataDir, sequence: ids, t3Watch: { probe: t3, clock } });
  const { host } = fixture;
  const agent = await fixture.agent();
  const mainChat = await fixture.thread(agent, 'Main');
  const workChat = await fixture.thread(agent, 'Feature work');
  const routine = Routine.parse(
    (await host.call('POST', '/api/routines', { agentId: agent.id, title: 'T3 updates', instruction: 'Watch report.', schedule: { kind: 'manual' } })).body,
  );
  const settle = () => host.host.t3Watches.idle();

  t3.thread('mcp:feature', { status: 'completed', activeRunId: null });
  t3.thread('mcp:archived-chat', { status: 'running' });
  await fixture.send(
    workChat,
    [
      `host-tool watch_t3_thread ${JSON.stringify({ threadId: 'mcp:feature', runId: runOf('mcp:feature', 1), routineId: routine.id, label: 'Feature PR' })}`,
      `host-tool watch_t3_thread ${JSON.stringify({ threadId: 'mcp:archived-chat', runId: runOf('mcp:archived-chat', 1), routineId: routine.id, label: 'Follow-up' })}`,
    ].join('\n'),
  );

  await clock.advance(60_000, settle);
  const firstRun = await settledRun(host, routine.id);
  const firstPrompt = MessageList.parse((await host.call('GET', `/api/threads/${firstRun.threadId ?? ''}/messages`)).body).messages[0]?.text ?? '';
  const firstBatch = T3WatchBatch.parse(JSON.parse(/```json\n([\s\S]*)\n```/.exec(firstPrompt)?.[1] ?? 'null'));
  await host.call('POST', '/api/t3-watches/acks', { batchId: firstBatch.batchId });

  const afterCreatingChatDelivery = {
    mainMessages: (await fixture.history(mainChat)).length,
    workLastMessage: (await fixture.history(workChat)).at(-1)?.split('\n')[0] ?? null,
    workLivePosted: fixture.events.received.filter((event) => event.kind === 'message.posted' && event.threadId === workChat.id).length,
  };

  await host.call('POST', `/api/threads/${workChat.id}/archive`);
  t3.finish('mcp:archived-chat');
  await clock.advance(60_000, settle);
  await settledRun(host, routine.id);

  expect({
    afterCreatingChatDelivery,
    mainAfterArchiveFallback: (await fixture.history(mainChat)).map((line) => line.split('\n')[0]),
    mainLivePosted: fixture.events.received.filter((event) => event.kind === 'message.posted' && event.threadId === mainChat.id).length,
  }).toMatchInlineSnapshot(`
    {
      "afterCreatingChatDelivery": {
        "mainMessages": 0,
        "workLastMessage": "assistant(completed): hello from pid <pid>: Watch report.",
        "workLivePosted": 1,
      },
      "mainAfterArchiveFallback": [
        "assistant(completed): hello from pid <pid>: Watch report.",
      ],
      "mainLivePosted": 1,
    }
  `);
});

it('reports idle_unverified clearly in the creating chat even when the routine stays quiet', async () => {
  const clock = new TickingClock();
  const t3 = new FakeT3(clock);
  fixture = await startChatFixture({ dataDir, sequence: ids, t3Watch: { probe: t3, clock } });
  const { host } = fixture;
  const agent = await fixture.agent();
  const mainChat = await fixture.thread(agent, 'Main');
  const workChat = await fixture.thread(agent, 'Shared work');
  const routine = Routine.parse(
    (
      await host.call('POST', '/api/routines', {
        agentId: agent.id,
        title: 'Quiet T3 updates',
        instruction: `host-tool routine_no_update ${JSON.stringify({ reason: 'nothing new' })}`,
        schedule: { kind: 'manual' },
      })
    ).body,
  );
  const settle = () => host.host.t3Watches.idle();

  t3.thread('mcp:shared', { status: 'completed', activeRunId: null });
  await fixture.send(
    workChat,
    `host-tool watch_t3_thread ${JSON.stringify({ threadId: 'mcp:shared', priorRunId: runOf('mcp:shared', 1), routineId: routine.id, label: 'Shared deploy' })}`,
  );
  await clock.advance(60_000, settle);
  const run = await settledRun(host, routine.id);

  expect({
    routineResult: run.result.kind,
    mainMessages: await fixture.history(mainChat),
    workNotice: (await fixture.history(workChat)).at(-1),
    workLivePosted: fixture.events.received.filter((event) => event.kind === 'message.posted' && event.threadId === workChat.id).length,
  }).toMatchInlineSnapshot(`
    {
      "mainMessages": [],
      "routineResult": "quiet",
      "workLivePosted": 1,
      "workNotice": "assistant(completed): Stopped tracking Shared deploy (mcp:shared), not confirmed finished (send to a shared thread without a run id).",
    }
  `);
});
