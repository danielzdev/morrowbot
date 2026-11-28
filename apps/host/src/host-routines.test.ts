import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Routine, RoutineList, RunRoutineResponse, ThreadList, Wait, WaitList, type Agent } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { RoutineClock } from './features/routines/index.ts';
import { startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';
import { sequence, type Sequence } from './testing/test-host.ts';

/** The schedule's clock, moved by hand; `tick` runs the scheduler as its timer would. */
function manualClock(start: string): RoutineClock & { set(at: string): void; tick(): void } {
  let now = Date.parse(start);
  let tick: () => void = () => undefined;
  return {
    now: () => now,
    every: (_ms, run) => {
      tick = run;
      return () => {
        tick = () => undefined;
      };
    },
    set: (at) => {
      now = Date.parse(at);
    },
    tick: () => {
      tick();
    },
  };
}

let dataDir: string;
let ids: Sequence;
let chat: ChatFixture | undefined;
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'oribot-routines-'));
  ids = sequence();
});
afterEach(async () => {
  if (chat !== undefined) {
    await chat.close();
    expect(chat.host.errors).toEqual([]);
    chat = undefined;
  }
  await rm(dataDir, { recursive: true, force: true });
});

async function start(clock: RoutineClock): Promise<ChatFixture> {
  chat = await startChatFixture({ dataDir, sequence: ids, routineClock: clock });
  return chat;
}

async function create(fixture: ChatFixture, agent: Agent, body: Record<string, unknown>): Promise<Routine> {
  const reply = await fixture.host.call('POST', '/api/routines', { agentId: agent.id, title: 'Morning check', instruction: 'hello', ...body });
  if (reply.status !== 201) throw new Error(`create refused: ${JSON.stringify(reply.body)}`);
  return Routine.parse(reply.body);
}

/** The routine once its last run has finished. */
async function settled(fixture: ChatFixture, id: string): Promise<Routine> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const { routines } = RoutineList.parse((await fixture.host.call('GET', '/api/routines')).body);
    const routine = routines.find((each) => each.id === id);
    if (routine !== undefined && routine.lastRun !== null && routine.lastRun.result.kind !== 'running') return routine;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('The run did not finish');
}

/** When the routine runs next and how its last run went. A missed run's `at` is when it was due. */
const timing = ({ nextRunAt, lastRun }: Routine) => ({
  nextRunAt,
  lastRun: lastRun === null ? null : { trigger: lastRun.trigger, result: lastRun.result.kind, ...(lastRun.result.kind === 'missed' ? { dueAt: lastRun.at } : {}) },
});

it('runs a cron routine at its time in its own time zone and posts the reply in a chat of its own', async () => {
  const clock = manualClock('2026-03-02T13:59:30.000Z');
  const fixture = await start(clock);
  const agent = await fixture.agent();
  const routine = await create(fixture, agent, { schedule: { kind: 'cron', expr: '0 9 * * 1-5', timezone: 'America/New_York' } });
  expect(routine.nextRunAt).toBe('2026-03-02T14:00:00.000Z');

  clock.set('2026-03-02T14:00:05.000Z');
  clock.tick();
  const ran = await settled(fixture, routine.id);
  expect(timing(ran)).toMatchInlineSnapshot(`
    {
      "lastRun": {
        "result": "posted",
        "trigger": "schedule",
      },
      "nextRunAt": "2026-03-03T14:00:00.000Z",
    }
  `);
  const { threads } = ThreadList.parse((await fixture.host.call('GET', `/api/agents/${agent.id}/threads`)).body);
  expect(threads.map(({ id, title }) => ({ id, title }))).toEqual([{ id: ran.lastRun?.threadId, title: 'Morning check' }]);
  const [thread] = threads;
  if (thread === undefined) throw new Error('no thread');
  expect(await fixture.history(thread)).toMatchInlineSnapshot(`
    [
      "user: hello",
      "assistant(completed): hello from pid <pid>: hello",
    ]
  `);
});

it('records runs missed while the host was off once, then moves on from now, and keeps routines across restarts', async () => {
  const clock = manualClock('2026-03-02T09:30:00.000Z');
  const first = await start(clock);
  const agent = await first.agent();
  const routine = await create(first, agent, { schedule: { kind: 'cron', expr: '0 * * * *', timezone: 'UTC' } });
  await first.close();
  chat = undefined;

  clock.set('2026-03-02T14:20:00.000Z');
  const second = await start(clock);
  const { routines } = RoutineList.parse((await second.host.call('GET', '/api/routines')).body);
  expect(routines.map((each) => ({ id: each.id, ...timing(each) }))).toMatchInlineSnapshot(`
    [
      {
        "id": "id-2",
        "lastRun": {
          "dueAt": "2026-03-02T10:00:00.000Z",
          "result": "missed",
          "trigger": "schedule",
        },
        "nextRunAt": "2026-03-02T15:00:00.000Z",
      },
    ]
  `);
  expect(routines.map(({ id }) => id)).toEqual([routine.id]);
});

it('runs a one-time routine once, and refuses one whose time has passed', async () => {
  const clock = manualClock('2026-03-02T09:00:00.000Z');
  const fixture = await start(clock);
  const agent = await fixture.agent();
  const past = await fixture.host.call('POST', '/api/routines', {
    agentId: agent.id,
    title: 'Late',
    instruction: 'hello',
    schedule: { kind: 'once', runAt: '2026-03-02T08:00:00Z' },
  });
  expect(past).toEqual({ status: 400, body: { error: { kind: 'invalid_request', message: 'That time has already passed.' } } });
  const routine = await create(fixture, agent, { schedule: { kind: 'once', runAt: '2026-03-02T10:00:00Z' } });
  expect(routine.nextRunAt).toBe('2026-03-02T10:00:00.000Z');

  clock.set('2026-03-02T10:00:20.000Z');
  clock.tick();
  const ran = await settled(fixture, routine.id);
  clock.tick();
  expect(timing(ran)).toMatchInlineSnapshot(`
    {
      "lastRun": {
        "result": "posted",
        "trigger": "schedule",
      },
      "nextRunAt": null,
    }
  `);
});

it('stays quiet when the agent says nothing is new, and reports a failed run clearly', async () => {
  const fixture = await start(manualClock('2026-03-02T09:00:00.000Z'));
  const agent = await fixture.agent();
  const quiet = await create(fixture, agent, { instruction: 'nothing-new', schedule: { kind: 'manual' }, stayQuietIfNothingNew: true });
  const failing = await create(fixture, agent, { instruction: 'fail', schedule: { kind: 'manual' } });

  expect((await fixture.host.call('POST', `/api/routines/${quiet.id}/run`, {})).status).toBe(202);
  const quietRun = (await settled(fixture, quiet.id)).lastRun;
  expect({ trigger: quietRun?.trigger, result: quietRun?.result.kind, threadId: quietRun?.threadId }).toMatchInlineSnapshot(`
    {
      "result": "quiet",
      "threadId": null,
      "trigger": "manual",
    }
  `);
  expect(ThreadList.parse((await fixture.host.call('GET', `/api/agents/${agent.id}/threads`)).body).threads).toEqual([]);

  await fixture.host.call('POST', `/api/routines/${failing.id}/run`, {});
  const failed = (await settled(fixture, failing.id)).lastRun?.result;
  expect(failed?.kind === 'failed' ? failed.reason : failed).toMatchInlineSnapshot(`"The provider failed: echo failed"`);
});

it('lets a local script wake a paused routine with a payload, once per wait', async () => {
  const fixture = await start(manualClock('2026-03-02T09:00:00.000Z'));
  const agent = await fixture.agent();
  const routine = await create(fixture, agent, { title: 'Build watcher', instruction: 'Check the build.', schedule: { kind: 'manual' }, active: false });
  const opened = await fixture.host.call('POST', '/api/waits', { agentId: agent.id, routineId: routine.id, note: 'nightly build' });
  const wait = Wait.parse(opened.body);
  expect(WaitList.parse((await fixture.host.call('GET', '/api/waits')).body).waits).toEqual([wait]);

  const anonymous = await fetch(`${fixture.host.url}/api/routines/${routine.id}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  expect(anonymous.status).toBe(401);

  const woken = await fixture.host.call('POST', `/api/routines/${routine.id}/run`, { payload: { status: 'green', tests: 412 }, waitId: wait.waitId });
  expect(woken.status).toBe(202);
  expect(RunRoutineResponse.parse(woken.body).run.trigger).toBe('wake');
  const again = await fixture.host.call('POST', `/api/routines/${routine.id}/run`, { waitId: wait.waitId });
  expect(again).toEqual({ status: 409, body: { error: { kind: 'conflict', message: 'That wait was woken or closed already.' } } });

  const ran = await settled(fixture, routine.id);
  expect(ran.active).toBe(false);
  expect(WaitList.parse((await fixture.host.call('GET', '/api/waits')).body).waits).toEqual([]);
  const { threads } = ThreadList.parse((await fixture.host.call('GET', `/api/agents/${agent.id}/threads`)).body);
  const [thread] = threads;
  if (thread === undefined) throw new Error('no thread');
  const [prompt] = await fixture.history(thread);
  expect(prompt).toMatchInlineSnapshot(`
    "user: Check the build.

    The job this routine was waiting on has reported back: nightly build

    It sent this payload:
    \`\`\`json
    {
      "status": "green",
      "tests": 412
    }
    \`\`\`"
  `);
});
