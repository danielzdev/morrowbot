import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { PluginList, QueuedSend, StartedSend, StopGenerationResponse } from '@morrowbot/contracts';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_PLUGIN_TIMEOUTS, systemProbe } from './features/plugins/index.ts';
import { openStorage } from './features/storage/index.ts';
import { isRunning, startDaemonFixture, stickyProbe, until, type DaemonFixture } from './testing/daemon-fixture.ts';

let chat: DaemonFixture | undefined;
afterEach(async () => {
  await chat?.close();
  chat = undefined;
});

async function start(fixture: DaemonFixture, threadId: string, text: string): Promise<string> {
  const reply = await fixture.host.call('POST', `/api/threads/${threadId}/messages`, { text });
  return StartedSend.parse(reply.body).generationId;
}

async function turnsSeen(fixture: DaemonFixture): Promise<number> {
  return (await fixture.daemonEvents()).filter((line) => line.startsWith('turn')).length;
}

function finishedCount(fixture: DaemonFixture, generationId: string): number {
  return fixture.events.of(generationId).filter((event) => typeof event === 'object' && event !== null && 'kind' in event && event.kind === 'generation.finished')
    .length;
}

it('registers the daemon through provider-info before the first turn, and a clean cancel drops the link while it keeps serving', async () => {
  chat = await startDaemonFixture();
  const fixture = chat;
  const thread = await fixture.thread(await fixture.agent());
  const beforeSend = fixture.daemonRows();
  const generationId = await start(fixture, thread.id, 'stall');
  await until(async () => (await turnsSeen(fixture)) === 1);
  const during = fixture.daemonRows();
  const stopped = StopGenerationResponse.parse((await fixture.host.call('POST', `/api/threads/${thread.id}/stop`)).body);
  const afterStop = fixture.daemonRows();
  await fixture.send(thread, 'hello');
  expect({
    beforeSend,
    during: during.map((row) => ({ ...row, linked: row.generationIds.includes(generationId) })),
    stopped: stopped.kind === 'stopped' ? stopped.message.outcome : stopped,
    afterStop,
    events: await fixture.daemonEvents(),
    history: await fixture.history(thread),
  }).toMatchInlineSnapshot(`
    {
      "afterStop": [
        {
          "generationIds": [],
          "state": "live",
        },
      ],
      "beforeSend": [],
      "during": [
        {
          "generationIds": [
            "id-3",
          ],
          "linked": true,
          "state": "live",
        },
      ],
      "events": [
        "daemon-start d1",
        "info false d1",
        "turn d1 stall",
        "turn d1 hello",
      ],
      "history": [
        "user: stall",
        "assistant(cancelled): ",
        "user: hello",
        "assistant(completed): d1: hello",
      ],
      "stopped": {
        "kind": "cancelled",
      },
    }
  `);
});

it('stops a daemon that ignores interrupt with kill-child-group, then a worker kill, then ESRCH, settles each of its turns once, and starts no new daemon before', async () => {
  const sticky = stickyProbe();
  chat = await startDaemonFixture({ probe: sticky.probe, timeouts: { ...DEFAULT_PLUGIN_TIMEOUTS, turnStopMs: 300 } });
  const fixture = chat;
  const agent = await fixture.agent();
  const [ignoring, sharing, other] = [await fixture.thread(agent, 'A'), await fixture.thread(agent, 'B'), await fixture.thread(agent, 'C')];
  const first = await start(fixture, ignoring.id, 'ignore-interrupt');
  const second = await start(fixture, sharing.id, 'stall');
  await until(async () => (await turnsSeen(fixture)) === 2);
  const worker = await fixture.workerPid();
  sticky.stick(fixture.daemonPgid(), () => isRunning(worker));
  const stopping = fixture.host.call('POST', `/api/threads/${ignoring.id}/stop`);
  await until(async () => (await fixture.signals()).length > 0);
  const meanwhile = fixture.host.call('POST', `/api/threads/${other.id}/messages`, { text: 'meanwhile' });
  await sleep(1_000);
  const startedDuringRetire = (await fixture.daemonEvents()).filter((line) => line.startsWith('info true') || line.includes('d2'));
  const stopped = StopGenerationResponse.parse((await stopping).body);
  await fixture.events.finished(second);
  await fixture.events.finished(StartedSend.parse((await meanwhile).body).generationId);
  const next = await fixture.send(ignoring, 'after');
  expect({
    startedDuringRetire,
    stopped: stopped.kind === 'stopped' ? stopped.message.outcome : stopped,
    finishedOnce: [finishedCount(fixture, first), finishedCount(fixture, second)],
    probe: sticky.seen,
    signals: await fixture.signals(),
    workerReplaced: (await fixture.workerPid()) !== worker,
    oldWorkerRunning: isRunning(worker),
    next: next.status,
    events: await fixture.daemonEvents(),
    histories: [await fixture.history(ignoring), await fixture.history(sharing), await fixture.history(other)],
  }).toMatchInlineSnapshot(`
    {
      "events": [
        "daemon-start d1",
        "info false d1",
        "turn d1 ignore-interrupt",
        "turn d1 stall",
        "daemon-exit d1",
        "daemon-start d2",
        "info true d2",
        "turn d2 meanwhile",
        "turn d2 after",
      ],
      "finishedOnce": [
        1,
        1,
      ],
      "histories": [
        [
          "user: ignore-interrupt",
          "assistant(interrupted): ",
          "user: after",
          "assistant(completed): d2: after",
        ],
        [
          "user: stall",
          "assistant(interrupted): ",
        ],
        [
          "user: meanwhile",
          "assistant(completed): d2: meanwhile",
        ],
      ],
      "next": 202,
      "oldWorkerRunning": false,
      "probe": [
        "alive",
        "gone",
      ],
      "signals": [
        "d1 SIGTERM",
      ],
      "startedDuringRetire": [],
      "stopped": {
        "kind": "interrupted",
      },
      "workerReplaced": true,
    }
  `);
});

it('on an unexpected daemon exit holds new work and settles its turns once the exit is verified, then registers a new daemon through provider-info {refresh:true}', async () => {
  const sticky = stickyProbe();
  let holding = true;
  chat = await startDaemonFixture({ probe: sticky.probe });
  const fixture = chat;
  const agent = await fixture.agent();
  const [exiting, sharing, other] = [await fixture.thread(agent, 'A'), await fixture.thread(agent, 'B'), await fixture.thread(agent, 'C')];
  await fixture.send(other, 'hello');
  sticky.stick(fixture.daemonPgid(), () => holding);
  const shared = await start(fixture, sharing.id, 'stall');
  await until(async () => (await turnsSeen(fixture)) === 2);
  const exited = await start(fixture, exiting.id, 'exit');
  await until(async () => (await fixture.daemonEvents()).includes('daemon-exit d1'));
  const heldThread = (await fixture.host.call('POST', `/api/threads/${exiting.id}/messages`, { text: 'again' })).status;
  const pending = fixture.host.call('POST', `/api/threads/${other.id}/messages`, { text: 'next' });
  await sleep(300);
  const whileChecking = await fixture.daemonEvents();
  const settledWhileChecking = [finishedCount(fixture, exited), finishedCount(fixture, shared)];
  holding = false;
  await fixture.events.finished(exited);
  await fixture.events.finished(shared);
  const next = StartedSend.parse((await pending).body);
  await fixture.events.finished(next.generationId);
  expect({
    settledWhileChecking,
    finishedOnce: [finishedCount(fixture, exited), finishedCount(fixture, shared)],
    heldThread,
    whileChecking,
    probe: sticky.seen,
    events: (await fixture.daemonEvents()).slice(whileChecking.length),
    rows: fixture.daemonRows(),
    histories: [await fixture.history(exiting), await fixture.history(sharing), await fixture.history(other)],
  }).toMatchInlineSnapshot(`
    {
      "events": [
        "daemon-start d2",
        "info true d2",
        "turn d2 next",
      ],
      "finishedOnce": [
        1,
        1,
      ],
      "heldThread": 202,
      "histories": [
        [
          "user: exit",
          "assistant(interrupted): ",
        ],
        [
          "user: stall",
          "assistant(interrupted): ",
        ],
        [
          "user: hello",
          "assistant(completed): d1: hello",
          "user: next",
          "assistant(completed): d2: next",
        ],
      ],
      "probe": [
        "alive",
        "gone",
      ],
      "rows": [
        {
          "generationIds": [],
          "state": "live",
        },
      ],
      "settledWhileChecking": [
        0,
        0,
      ],
      "whileChecking": [
        "daemon-start d1",
        "info false d1",
        "turn d1 hello",
        "turn d1 stall",
        "turn d1 exit",
        "daemon-exit d1",
      ],
    }
  `);
});

it('disabling the plugin mid-turn keeps the daemon link, so the thread stays held until the daemon is confirmed gone', async () => {
  const sticky = stickyProbe();
  let holding = true;
  chat = await startDaemonFixture({ probe: sticky.probe });
  const fixture = chat;
  const thread = await fixture.thread(await fixture.agent());
  const generationId = await start(fixture, thread.id, 'stall');
  await until(async () => (await turnsSeen(fixture)) === 1);
  sticky.stick(fixture.daemonPgid(), () => holding);
  const disabled = (await fixture.host.call('PUT', '/api/plugins/daemon/enabled', { enabled: false })).status;
  await fixture.events.finished(generationId);
  const rows = fixture.daemonRows().map((row) => ({ state: row.state, linked: row.generationIds.includes(generationId) }));
  const send = async () => (await fixture.host.call('POST', `/api/threads/${thread.id}/messages`, { text: 'again' })).body;
  const whileHeld = QueuedSend.parse(await send()).queued.state;
  holding = false;
  await until(() => fixture.daemonRows().length === 0);
  expect({ disabled, rows, whileHeld, afterRelease: await send(), history: await fixture.history(thread) }).toMatchInlineSnapshot(`
    {
      "afterRelease": {
        "error": {
          "kind": "conflict",
          "message": "Provider plugin daemon is not available: Plugin "daemon" is not running (disabled)",
        },
      },
      "disabled": 200,
      "history": [
        "user: stall",
        "assistant(cancelled): ",
      ],
      "rows": [
        {
          "linked": true,
          "state": "blocked",
        },
      ],
      "whileHeld": {
        "kind": "queued",
      },
    }
  `);
});

it('shares one daemon start between concurrent cold sends', async () => {
  chat = await startDaemonFixture();
  const fixture = chat;
  await fixture.setFlag('pause-info', true);
  const agent = await fixture.agent();
  const [a, b] = [await fixture.thread(agent, 'A'), await fixture.thread(agent, 'B')];
  const sends = [
    fixture.host.call('POST', `/api/threads/${a.id}/messages`, { text: 'one' }),
    fixture.host.call('POST', `/api/threads/${b.id}/messages`, { text: 'two' }),
  ];
  await until(async () => (await fixture.daemonEvents()).includes('info false d1'));
  await sleep(100);
  await fixture.setFlag('pause-info', false);
  const sent = await Promise.all(sends);
  for (const reply of sent) await fixture.events.finished(StartedSend.parse(reply.body).generationId);
  expect({ statuses: sent.map((reply) => reply.status), events: (await fixture.daemonEvents()).sort() }).toMatchInlineSnapshot(`
    {
      "events": [
        "daemon-start d1",
        "info false d1",
        "turn d1 one",
        "turn d1 two",
      ],
      "statuses": [
        202,
        202,
      ],
    }
  `);
});

it('refuses provider-info and usage while a daemon row from before a restart is blocked; Release anyway re-enables them and a new daemon registers', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'oribot-daemon-'));
  const storage = openStorage(path.join(dataDir, 'oribot.sqlite'), () => '2026-01-01T00:00:00.000Z');
  const leftover = { pgid: 4_000_000, regId: 'old-daemon', pluginId: 'daemon', kind: 'daemon', bootId: null, leaderStart: 'Thu Jan  1 00:00:00 2026' } as const;
  storage.childGroups.insert({ ...leftover, startedAt: '2026-01-01T00:00:00.000Z', generationIds: [] });
  storage.close();
  let skipped = 0;
  chat = await startDaemonFixture({
    dataDir,
    probe: {
      signalGroup: (pgid) => (pgid === leftover.pgid ? 'alive' : systemProbe.signalGroup(pgid)),
      leader: async (pid) =>
        pid === leftover.pgid ? { kind: 'process', start: leftover.leaderStart, args: 'node /sdk/command-guard.ts' } : systemProbe.leader(pid),
      bootId: () => systemProbe.bootId(),
    },
    clock: { now: () => new Date().toISOString(), monotonic: () => performance.now() + skipped },
  });
  const fixture = chat;
  const read = async () => ({
    info: (await fixture.host.call('GET', '/api/plugins/daemon/info')).status,
    usage: (await fixture.host.call('GET', '/api/plugins/daemon/usage')).status,
  });
  const blocked = await read();
  const listed = PluginList.parse((await fixture.host.call('GET', '/api/plugins')).body).plugins.find(({ manifest }) => manifest.id === 'daemon')?.blockedGroups;
  const eventsWhileBlocked = await fixture.daemonEvents();
  const early = (await fixture.host.call('POST', '/api/child-groups/old-daemon/release')).status;
  skipped = 61_000;
  const released = (await fixture.host.call('POST', '/api/child-groups/old-daemon/release')).body;
  const after = await read();
  expect({ blocked, listed, eventsWhileBlocked, early, released, after, rows: fixture.daemonRows(), events: await fixture.daemonEvents() })
    .toMatchInlineSnapshot(`
      {
        "after": {
          "info": 200,
          "usage": 200,
        },
        "blocked": {
          "info": 409,
          "usage": 409,
        },
        "early": 409,
        "events": [
          "daemon-start d1",
          "info true d1",
          "usage d1",
        ],
        "eventsWhileBlocked": [],
        "listed": [
          {
            "kind": "daemon",
            "pgid": 4000000,
            "pluginId": "daemon",
            "regId": "old-daemon",
            "releasable": false,
            "startedAt": "2026-01-01T00:00:00.000Z",
          },
        ],
        "released": {
          "released": true,
        },
        "rows": [
          {
            "generationIds": [],
            "state": "live",
          },
        ],
      }
    `);
  await rm(dataDir, { recursive: true, force: true });
});
