import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Agent, InviteResponse, MessageList, RoutineList, StartedSend, T3WatchBatch, T3WatchList, type RoutineRun, type Thread } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { T3WatchClock } from './features/t3-watch/index.ts';
import { ECHO, hidePid, startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';
import { postMcp, savedTools } from './testing/host-tools-client.ts';
import { FakeT3, runOf, START } from './testing/t3-watch-kit.ts';
import { sequence } from './testing/test-host.ts';

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

const ListedToolsBody = z.object({
  result: z.object({
    tools: z.array(z.object({ name: z.string() })),
  }),
});

let dataDir: string;
let clock: TickingClock;
let t3: FakeT3;
let chat: ChatFixture;
beforeEach(async () => {
  dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'orikami-t3-watch-tools-')));
  clock = new TickingClock();
  t3 = new FakeT3(clock);
  chat = await startChatFixture({ dataDir, sequence: sequence(), t3Watch: { probe: t3, clock } });
});
afterEach(async () => {
  await chat.close();
  expect(chat.host.errors).toEqual([]);
  await rm(dataDir, { recursive: true, force: true });
});

async function agentWithChat(name: string): Promise<{ readonly agent: Agent; readonly thread: Thread }> {
  const agent = Agent.parse((await chat.host.call('POST', '/api/agents', { name, description: `${name} agent`, provider: ECHO })).body);
  return { agent, thread: await chat.thread(agent) };
}

const call = (name: string, args: object): string => `host-tool ${name} ${JSON.stringify(args)}`;

async function lastReply(thread: Thread): Promise<string[]> {
  const history = await chat.history(thread);
  return (history.at(-1) ?? '').replace(/^assistant\(completed\): /, '').split('\n');
}

async function settledRun(routineId: string): Promise<RoutineRun> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const { routines } = RoutineList.parse((await chat.host.call('GET', '/api/routines')).body);
    const run = routines.find((each) => each.id === routineId)?.lastRun ?? null;
    if (run !== null && run.result.kind !== 'running') return run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('The routine run did not finish');
}

it('watches a T3 thread bound to the agent’s routine, delivers its batch, lists pending batches, acks and unwatches', async () => {
  const lead = await agentWithChat('Lead');
  await chat.send(
    lead.thread,
    call('create_routine', {
      title: 'T3 updates',
      instruction: 'Handle T3 watch batch.',
      schedule: { kind: 'manual' },
    }),
  );
  const [routine] = RoutineList.parse((await chat.host.call('GET', `/api/routines?agentId=${lead.agent.id}`)).body).routines;
  if (routine === undefined) throw new Error('missing routine');

  t3.thread('mcp:build', { status: 'completed', activeRunId: null });
  t3.thread('mcp:extra', { status: 'running' });
  await chat.send(
    lead.thread,
    [
      call('watch_t3_thread', { threadId: 'mcp:build', runId: runOf('mcp:build', 1), routineId: routine.id, label: 'CI build' }),
      call('watch_t3_thread', { threadId: 'mcp:extra', runId: runOf('mcp:extra', 1), routineId: routine.id, label: 'Extra task' }),
    ].join('\n'),
  );
  const watchReplies = (await lastReply(lead.thread)).map(hidePid);

  await clock.advance(60_000, () => chat.host.host.t3Watches.idle());
  const run = await settledRun(routine.id);
  const prompt = MessageList.parse((await chat.host.call('GET', `/api/threads/${run.threadId ?? ''}/messages`)).body).messages[0]?.text ?? '';
  const batch = T3WatchBatch.parse(JSON.parse(/```json\n([\s\S]*)\n```/.exec(prompt)?.[1] ?? 'null'));

  await chat.send(
    lead.thread,
    [
      call('list_t3_watches', {}),
      call('ack_t3_batch', { batchId: batch.batchId }),
      call('ack_t3_batch', { batchId: batch.batchId }),
      call('unwatch_t3_thread', { threadId: 'mcp:extra' }),
      call('list_t3_watches', {}),
      call('list_t3_watches', { includeSettled: true }),
    ].join('\n'),
  );

  expect({
    watchReplies,
    deliveredEvents: batch.events.map(({ event, unverified }) => `${event.kind} ${event.scope === 'watch' ? event.threadId : ''} unverified=${String(unverified)}`),
    deliveredStatus: batch.status.map(({ threadId, state }) => `${threadId} ${state}`),
    roundtripReplies: (await lastReply(lead.thread)).map(hidePid),
  }).toMatchInlineSnapshot(`
    {
      "deliveredEvents": [
        "finished mcp:build unverified=false",
      ],
      "deliveredStatus": [
        "mcp:build finished",
        "mcp:extra running",
      ],
      "roundtripReplies": [
        "list_t3_watches: {"watches":[{"watchId":"id-10","threadId":"mcp:extra","source":"registered","label":"Extra task","state":"running","reason":null,"runId":"run:thread:mcp%3Aextra:ordinal:1","registeredAt":"2026-11-28T09:00:00.000Z","settledAt":null,"updatedAt":"2026-11-28T09:00:51.000Z","routineId":"id-5"},{"watchId":"id-9","threadId":"mcp:build","source":"registered","label":"CI build","state":"finished","reason":null,"runId":"run:thread:mcp%3Abuild:ordinal:1","registeredAt":"2026-11-28T09:00:00.000Z","settledAt":null,"updatedAt":"2026-11-28T09:00:21.000Z","routineId":"id-5"}],"pendingBatches":[{"batchId":"id-13","createdAt":"2026-11-28T09:00:47.000Z","attempts":1,"resendAt":"2026-11-28T09:10:47.000Z","events":[{"event":{"scope":"watch","kind":"finished","watchId":"id-9","threadId":"mcp:build","runId":"run:thread:mcp%3Abuild:ordinal:1","eventId":"id-12","fingerprint":"ok","reason":null,"at":"2026-11-28T09:00:21.000Z"},"unverified":false}]}],"pendingEvents":[{"scope":"watch","kind":"finished","watchId":"id-9","threadId":"mcp:build","runId":"run:thread:mcp%3Abuild:ordinal:1","eventId":"id-12","fingerprint":"ok","reason":null,"at":"2026-11-28T09:00:21.000Z"}]}",
        "ack_t3_batch: {"batchId":"id-13","result":"acked"}",
        "ack_t3_batch: {"batchId":"id-13","result":"already_acked"}",
        "unwatch_t3_thread: {"threadId":"mcp:extra","removedWatchIds":["id-10"]}",
        "list_t3_watches: {"watches":[],"pendingBatches":[],"pendingEvents":[]}",
        "list_t3_watches: {"watches":[{"watchId":"id-9","threadId":"mcp:build","source":"registered","label":"CI build","state":"finished","reason":null,"runId":"run:thread:mcp%3Abuild:ordinal:1","registeredAt":"2026-11-28T09:00:00.000Z","settledAt":"2026-11-28T09:01:00.000Z","updatedAt":"2026-11-28T09:01:00.000Z","routineId":"id-5"}],"pendingBatches":[],"pendingEvents":[]}",
      ],
      "watchReplies": [
        "watch_t3_thread: {"watch":{"watchId":"id-9","threadId":"mcp:build","source":"registered","label":"CI build","state":"watching","reason":null,"runId":"run:thread:mcp%3Abuild:ordinal:1","registeredAt":"2026-11-28T09:00:00.000Z","settledAt":null,"updatedAt":"2026-11-28T09:00:00.000Z","routineId":"id-5"}}",
        "watch_t3_thread: {"watch":{"watchId":"id-10","threadId":"mcp:extra","source":"registered","label":"Extra task","state":"watching","reason":null,"runId":"run:thread:mcp%3Aextra:ordinal:1","registeredAt":"2026-11-28T09:00:00.000Z","settledAt":null,"updatedAt":"2026-11-28T09:00:00.000Z","routineId":"id-5"}}",
      ],
    }
  `);
});

it('enforces cross-agent ownership on T3 watches and batches and rejects invalid inputs', async () => {
  const owner = await agentWithChat('Owner');
  const other = await agentWithChat('Other');
  await chat.send(owner.thread, call('create_routine', { title: 'Owner T3', instruction: 'Handle.', schedule: { kind: 'manual' } }));
  await chat.send(other.thread, call('create_routine', { title: 'Other T3', instruction: 'Handle.', schedule: { kind: 'manual' } }));
  const [ownerRoutine] = RoutineList.parse((await chat.host.call('GET', `/api/routines?agentId=${owner.agent.id}`)).body).routines;
  const [otherRoutine] = RoutineList.parse((await chat.host.call('GET', `/api/routines?agentId=${other.agent.id}`)).body).routines;
  if (ownerRoutine === undefined || otherRoutine === undefined) throw new Error('missing routines');

  t3.thread('mcp:private', { status: 'completed', activeRunId: null });
  await chat.send(
    owner.thread,
    call('watch_t3_thread', { threadId: 'mcp:private', runId: runOf('mcp:private', 1), routineId: ownerRoutine.id, label: 'Private' }),
  );
  const [ownerWatch] = T3WatchList.parse((await chat.host.call('GET', '/api/t3-watches')).body).watches;
  if (ownerWatch === undefined) throw new Error('missing watch');

  await clock.advance(60_000, () => chat.host.host.t3Watches.idle());
  const run = await settledRun(ownerRoutine.id);
  const prompt = MessageList.parse((await chat.host.call('GET', `/api/threads/${run.threadId ?? ''}/messages`)).body).messages[0]?.text ?? '';
  const batch = T3WatchBatch.parse(JSON.parse(/```json\n([\s\S]*)\n```/.exec(prompt)?.[1] ?? 'null'));

  await chat.send(
    other.thread,
    [
      call('list_t3_watches', { includeSettled: true }),
      call('watch_t3_thread', { threadId: 'mcp:new', routineId: ownerRoutine.id }),
      call('watch_t3_thread', { threadId: 'mcp:private', routineId: otherRoutine.id }),
      call('unwatch_t3_thread', { threadId: 'mcp:private' }),
      call('unwatch_t3_thread', { watchId: ownerWatch.watchId }),
      call('ack_t3_batch', { batchId: batch.batchId }),
      call('unwatch_t3_thread', {}),
      call('ack_t3_batch', { batchId: 'no-such-batch' }),
    ].join('\n'),
  );

  const watchesAfter = T3WatchList.parse((await chat.host.call('GET', '/api/t3-watches')).body).watches;
  expect({
    otherReplies: (await lastReply(other.thread)).map(hidePid),
    ownerWatchStillUnsettled: watchesAfter.map(({ threadId, state, settledAt }) => ({ threadId, state, settled: settledAt !== null })),
  }).toMatchInlineSnapshot(`
    {
      "otherReplies": [
        "list_t3_watches: {"watches":[],"pendingBatches":[],"pendingEvents":[]}",
        "watch_t3_thread: error You have no routine id-7",
        "watch_t3_thread: error Thread mcp:private is already watched by another agent.",
        "unwatch_t3_thread: error No T3 watch for thread mcp:private",
        "unwatch_t3_thread: error No T3 watch id-15",
        "ack_t3_batch: error Unknown T3 watch batch id-18",
        "unwatch_t3_thread: error ✖ Provide threadId or watchId.",
        "ack_t3_batch: error Unknown T3 watch batch no-such-batch",
      ],
      "ownerWatchStillUnsettled": [
        {
          "settled": false,
          "state": "finished",
          "threadId": "mcp:private",
        },
      ],
    }
  `);
});

it('hides T3 watch tools from agents shared with scoped members and refuses direct calls', async () => {
  const shared = await agentWithChat('Shared');
  const invite = await chat.host.call('POST', '/api/members/invites', {
    name: 'Guest',
    url: 'https://studio.example.ts.net',
    access: { kind: 'scoped', agents: [{ agentId: shared.agent.id, canEdit: false, workspace: 'read-only', interAgentAllowlist: [] }] },
  });
  expect(invite.status).toBe(201);
  InviteResponse.parse(invite.body);

  const sent = StartedSend.parse((await chat.host.call('POST', `/api/threads/${shared.thread.id}/messages`, { text: 'stall-polite', sessionChoice: { kind: 'auto' } })).body);
  const tools = await vi.waitFor(async () => {
    const saved = await savedTools(dataDir);
    if (saved.kind !== 'mcp') throw new Error('no host tools');
    return saved;
  });
  const listed = await postMcp(tools.url, tools.token, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const callList = await postMcp(tools.url, tools.token, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_t3_watches', arguments: {} } });
  const callAck = await postMcp(tools.url, tools.token, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'ack_t3_batch', arguments: { batchId: 'batch-1' } },
  });
  await chat.host.call('POST', `/api/threads/${shared.thread.id}/stop`);
  await chat.events.finished(sent.generationId);

  const toolNames = ListedToolsBody.parse(listed.body).result.tools.map(({ name }) => name);
  expect({
    toolNames,
    callList: callList.body,
    callAck: callAck.body,
  }).toMatchInlineSnapshot(`
    {
      "callAck": {
        "id": 3,
        "jsonrpc": "2.0",
        "result": {
          "content": [
            {
              "text": "T3 Code watches are not available to agents shared with other people.",
              "type": "text",
            },
          ],
          "isError": true,
        },
      },
      "callList": {
        "id": 2,
        "jsonrpc": "2.0",
        "result": {
          "content": [
            {
              "text": "T3 Code watches are not available to agents shared with other people.",
              "type": "text",
            },
          ],
          "isError": true,
        },
      },
      "toolNames": [
        "list_agents",
        "send_message",
        "search_memories",
        "remember",
        "forget_memory",
        "list_vault_items",
        "spawn_subagent",
        "wait_subagents",
        "list_subagents",
        "react_to_message",
        "stay_quiet",
        "attach_files",
        "propose_card",
      ],
    }
  `);
});
