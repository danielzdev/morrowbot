import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Agent, InviteResponse, RoutineList, StartedSend, ThreadList, type Thread } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { RoutineClock } from './features/routines/index.ts';
import { ECHO, hidePid, startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';
import { postMcp, savedTools } from './testing/host-tools-client.ts';
import { sequence } from './testing/test-host.ts';

function fixedClock(at: string): RoutineClock {
  const now = Date.parse(at);
  return {
    now: () => now,
    every: () => () => undefined,
  };
}

let dataDir: string;
let chat: ChatFixture;
beforeEach(async () => {
  dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-routine-tools-')));
  chat = await startChatFixture({ dataDir, sequence: sequence(), routineClock: fixedClock('2026-03-02T09:00:00.000Z') });
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

async function settledRoutine(id: string) {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const { routines } = RoutineList.parse((await chat.host.call('GET', '/api/routines')).body);
    const routine = routines.find((each) => each.id === id);
    if (routine !== undefined && routine.lastRun !== null && routine.lastRun.result.kind !== 'running') return routine;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('The routine run did not finish');
}

it('creates cron, one-time, manual and paused routines, lists, updates and deletes only the calling agent’s routines', async () => {
  const owner = await agentWithChat('Owner');
  await chat.send(
    owner.thread,
    [
      call('create_routine', {
        title: 'Weekday standup',
        instruction: 'Check open PRs.',
        schedule: { kind: 'cron', expr: '0 9 * * 1-5', timezone: 'UTC' },
        stayQuietIfNothingNew: true,
      }),
      call('create_routine', {
        title: 'Release reminder',
        instruction: 'Tag release.',
        schedule: { kind: 'once', runAt: '2026-03-02T12:00:00.000Z' },
      }),
      call('create_routine', {
        title: 'Paused manual check',
        instruction: 'Run on demand.',
        schedule: { kind: 'manual' },
        active: false,
      }),
    ].join('\n'),
  );
  const created = RoutineList.parse((await chat.host.call('GET', `/api/routines?agentId=${owner.agent.id}`)).body).routines;
  const [cronRoutine, onceRoutine, manualRoutine] = created;
  if (cronRoutine === undefined || onceRoutine === undefined || manualRoutine === undefined) throw new Error('missing routines');

  await chat.send(
    owner.thread,
    [
      call('list_routines', {}),
      call('update_routine', {
        routineId: cronRoutine.id,
        title: 'Weekday standup v2',
        instruction: 'Check open PRs and CI.',
        active: false,
      }),
      call('delete_routine', { routineId: onceRoutine.id }),
      call('list_routines', {}),
    ].join('\n'),
  );

  const after = RoutineList.parse((await chat.host.call('GET', `/api/routines?agentId=${owner.agent.id}`)).body).routines;
  expect({
    replies: (await lastReply(owner.thread)).map(hidePid),
    remaining: after.map(({ id, title, active, schedule, nextRunAt }) => ({ id, title, active, schedule, nextRunAt })),
  }).toMatchInlineSnapshot(`
    {
      "remaining": [
        {
          "active": false,
          "id": "id-5",
          "nextRunAt": null,
          "schedule": {
            "expr": "0 9 * * 1-5",
            "kind": "cron",
            "timezone": "UTC",
          },
          "title": "Weekday standup v2",
        },
        {
          "active": false,
          "id": "id-7",
          "nextRunAt": null,
          "schedule": {
            "kind": "manual",
          },
          "title": "Paused manual check",
        },
      ],
      "replies": [
        "list_routines: {"routines":[{"id":"id-5","title":"Weekday standup","instruction":"Check open PRs.","schedule":{"kind":"cron","expr":"0 9 * * 1-5","timezone":"UTC"},"active":true,"stayQuietIfNothingNew":true,"nextRunAt":"2026-03-03T09:00:00.000Z","lastRunAt":null,"lastRun":null},{"id":"id-6","title":"Release reminder","instruction":"Tag release.","schedule":{"kind":"once","runAt":"2026-03-02T12:00:00.000Z"},"active":true,"stayQuietIfNothingNew":false,"nextRunAt":"2026-03-02T12:00:00.000Z","lastRunAt":null,"lastRun":null},{"id":"id-7","title":"Paused manual check","instruction":"Run on demand.","schedule":{"kind":"manual"},"active":false,"stayQuietIfNothingNew":false,"nextRunAt":null,"lastRunAt":null,"lastRun":null}]}",
        "update_routine: {"routine":{"id":"id-5","title":"Weekday standup v2","instruction":"Check open PRs and CI.","schedule":{"kind":"cron","expr":"0 9 * * 1-5","timezone":"UTC"},"active":false,"stayQuietIfNothingNew":true,"nextRunAt":null,"lastRunAt":null,"lastRun":null}}",
        "delete_routine: {"deleted":"id-6"}",
        "list_routines: {"routines":[{"id":"id-5","title":"Weekday standup v2","instruction":"Check open PRs and CI.","schedule":{"kind":"cron","expr":"0 9 * * 1-5","timezone":"UTC"},"active":false,"stayQuietIfNothingNew":true,"nextRunAt":null,"lastRunAt":null,"lastRun":null},{"id":"id-7","title":"Paused manual check","instruction":"Run on demand.","schedule":{"kind":"manual"},"active":false,"stayQuietIfNothingNew":false,"nextRunAt":null,"lastRunAt":null,"lastRun":null}]}",
      ],
    }
  `);
});

it('marks a live routine run silent via routine_no_update and refuses it in a normal chat turn', async () => {
  const owner = await agentWithChat('Owner');
  await chat.send(
    owner.thread,
    [
      call('routine_no_update', { reason: 'Not a routine' }),
      call('create_routine', {
        title: 'Quiet monitor',
        instruction: call('routine_no_update', { reason: 'Nothing changed' }),
        schedule: { kind: 'manual' },
      }),
    ].join('\n'),
  );
  const chatReplies = (await lastReply(owner.thread)).map(hidePid);
  const [routine] = RoutineList.parse((await chat.host.call('GET', `/api/routines?agentId=${owner.agent.id}`)).body).routines;
  if (routine === undefined) throw new Error('missing routine');

  const started = await chat.host.call('POST', `/api/routines/${routine.id}/run`, {});
  expect(started.status).toBe(202);
  const finished = await settledRoutine(routine.id);
  const threads = ThreadList.parse((await chat.host.call('GET', `/api/agents/${owner.agent.id}/threads`)).body).threads;

  expect({
    chatReplies,
    lastRun: finished.lastRun === null ? null : { trigger: finished.lastRun.trigger, result: finished.lastRun.result.kind, threadId: finished.lastRun.threadId },
    remainingThreads: threads.map(({ title }) => title),
  }).toMatchInlineSnapshot(`
    {
      "chatReplies": [
        "routine_no_update: error routine_no_update can only be called during a routine run.",
        "create_routine: {"routine":{"id":"id-5","title":"Quiet monitor","instruction":"host-tool routine_no_update {\\"reason\\":\\"Nothing changed\\"}","schedule":{"kind":"manual"},"active":true,"stayQuietIfNothingNew":false,"nextRunAt":null,"lastRunAt":null,"lastRun":null}}",
      ],
      "lastRun": {
        "result": "quiet",
        "threadId": null,
        "trigger": "manual",
      },
      "remainingThreads": [
        "Chat",
      ],
    }
  `);
});

it('refuses cross-agent routine access and rejects invalid schedules and inputs', async () => {
  const owner = await agentWithChat('Owner');
  const other = await agentWithChat('Other');
  await chat.send(
    owner.thread,
    call('create_routine', {
      title: 'Private check',
      instruction: 'Check status.',
      schedule: { kind: 'manual' },
    }),
  );
  const [privateRoutine] = RoutineList.parse((await chat.host.call('GET', `/api/routines?agentId=${owner.agent.id}`)).body).routines;
  if (privateRoutine === undefined) throw new Error('missing routine');

  await chat.send(
    other.thread,
    [
      call('list_routines', {}),
      call('update_routine', { routineId: privateRoutine.id, title: 'Hijacked' }),
      call('delete_routine', { routineId: privateRoutine.id }),
      call('create_routine', {
        agentId: owner.agent.id,
        title: 'Spoofed',
        instruction: 'Nope',
        schedule: { kind: 'manual' },
      }),
      call('create_routine', {
        title: 'Bad cron',
        instruction: 'Nope',
        schedule: { kind: 'cron', expr: 'not a cron', timezone: 'UTC' },
      }),
      call('create_routine', {
        title: 'Bad tz',
        instruction: 'Nope',
        schedule: { kind: 'cron', expr: '0 9 * * *', timezone: 'Mars/Olympus' },
      }),
      call('create_routine', {
        title: 'In the past',
        instruction: 'Nope',
        schedule: { kind: 'once', runAt: '2026-03-02T08:00:00.000Z' },
      }),
      call('update_routine', { routineId: privateRoutine.id }),
    ].join('\n'),
  );

  const stillThere = RoutineList.parse((await chat.host.call('GET', `/api/routines?agentId=${owner.agent.id}`)).body).routines;
  expect({
    otherReplies: (await lastReply(other.thread)).map(hidePid),
    ownerRoutines: stillThere.map(({ id, title }) => ({ id, title })),
  }).toMatchInlineSnapshot(`
    {
      "otherReplies": [
        "list_routines: {"routines":[]}",
        "update_routine: error You have no routine id-7",
        "delete_routine: error You have no routine id-7",
        "create_routine: error ✖ Unrecognized key: "agentId"",
        "create_routine: error ✖ Use five cron fields (minute hour day month weekday) or @hourly, @daily, @weekly, @monthly or @yearly",
        "  → at schedule.expr",
        "create_routine: error ✖ Unknown time zone",
        "  → at schedule.timezone",
        "create_routine: error That time has already passed.",
        "update_routine: error ✖ Change at least one field",
      ],
      "ownerRoutines": [
        {
          "id": "id-7",
          "title": "Private check",
        },
      ],
    }
  `);
});

it('hides routine tools from agents shared with scoped members and refuses direct calls', async () => {
  const shared = await agentWithChat('Shared');
  const created = await chat.host.call('POST', '/api/routines', {
    agentId: shared.agent.id,
    title: 'Owner only routine',
    instruction: 'Stay private.',
    schedule: { kind: 'manual' },
  });
  expect(created.status).toBe(201);
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
  const callList = await postMcp(tools.url, tools.token, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_routines', arguments: {} } });
  const callCreate = await postMcp(tools.url, tools.token, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'create_routine', arguments: { title: 'Sneaky', instruction: 'Nope', schedule: { kind: 'manual' } } },
  });
  await chat.host.call('POST', `/api/threads/${shared.thread.id}/stop`);
  await chat.events.finished(sent.generationId);

  const ListedToolsBody = z.object({ result: z.object({ tools: z.array(z.object({ name: z.string() })) }) });
  const toolNames = ListedToolsBody.parse(listed.body).result.tools.map(({ name }) => name);
  expect({
    toolNames,
    callList: callList.body,
    callCreate: callCreate.body,
  }).toMatchInlineSnapshot(`
    {
      "callCreate": {
        "id": 3,
        "jsonrpc": "2.0",
        "result": {
          "content": [
            {
              "text": "Routines are not available to agents shared with other people.",
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
              "text": "Routines are not available to agents shared with other people.",
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
      ],
    }
  `);
});
