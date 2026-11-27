import { afterEach, expect, it } from 'vitest';
import type { PluginStatusEvent } from '@morrowbot/contracts';
import { bootHost, fakeProbe, GUARD, groupRow, startTurn, statuses, stopHosts, type Harness, type ProbeAnswer } from './plugin-test-kit.ts';

afterEach(stopHosts);

const echoEvents = (events: readonly PluginStatusEvent[], from = 0) =>
  events
    .slice(from)
    .filter((event) => event.pluginId === 'echo')
    .map(({ status }) => (status.kind === 'quarantined' ? { ...status, detail: status.detail.replace(/\d+/, 'PGID') } : status));

it('settles a turn through onLost when its worker crashes', async () => {
  const h = await bootHost();
  const turn = startTurn(h, 'echo', 'g1', 'crash');
  expect({ result: await turn.result, status: await h.untilStatus('echo', 'crashed') }).toMatchInlineSnapshot(`
    {
      "result": {
        "kind": "lost",
        "text": "hello from pid CHILD:",
      },
      "status": {
        "kind": "crashed",
        "reason": {
          "code": 3,
          "kind": "exit",
          "signal": null,
        },
      },
    }
  `);
});

it('kills a worker that ignores Stop, settles its turn and restarts it', async () => {
  const h = await bootHost({ timeouts: { turnStopMs: 200 } });
  const before = h.host.revision('echo').worker;
  const turn = startTurn(h, 'echo', 'g1', 'stall');
  await turn.pid;
  const from = h.events.length;
  h.host.cancelTurn('echo', 'g1');
  const result = await turn.result;
  await h.untilStatus('echo', 'running', from);
  const after = h.host.revision('echo').worker;
  expect({ result, events: echoEvents(h.events, from), newWorker: after !== before, next: (await startTurn(h, 'echo', 'g2', 'next').result).kind })
    .toMatchInlineSnapshot(`
      {
        "events": [
          {
            "kind": "stopped",
          },
          {
            "kind": "starting",
          },
          {
            "kind": "running",
          },
        ],
        "newWorker": true,
        "next": "end",
        "result": {
          "kind": "lost",
          "text": "hello from pid CHILD:",
        },
      }
    `);
});

/** Starts a `sleep` turn (one guarded group), makes its group look alive, and kills the worker from outside. */
async function quarantineEcho(h: Harness, fake: ReturnType<typeof fakeProbe>) {
  const registered = h.groups.nextInsert();
  const turn = startTurn(h, 'echo', 'g1', 'sleep');
  const row = await registered;
  fake.script(row.pgid, { signal: 'alive', leader: { kind: 'none' } });
  const from = h.events.length;
  process.kill(await turn.pid, 'SIGKILL');
  const result = await turn.result;
  const quarantined = await h.untilStatus('echo', 'quarantined', from);
  return { row, from, result, quarantined };
}

it('quarantines a worker whose group cannot be confirmed gone, and restarts it once the group is released', { timeout: 20_000 }, async () => {
  const fake = fakeProbe();
  const h = await bootHost({ probe: fake.probe });
  const { row, from, result, quarantined } = await quarantineEcho(h, fake);
  const changed = (await h.host.setConfig('echo', { greeting: 'hey' })).kind;
  const whileQuarantined = { status: statuses(h.host).echo?.kind, worker: h.host.revision('echo').worker };
  const blocked = h.host.groups.blocked('echo').map((group) => ({ ...group, pgid: group.pgid === row.pgid ? 'PGID' : group.pgid }));
  fake.script(row.pgid, { signal: 'gone', leader: { kind: 'none' } });
  await h.untilStatus('echo', 'running', from);
  expect({
    row: { ...row, pgid: 'PGID', leaderStart: row.leaderStart === '' ? 'EMPTY' : 'LSTART' },
    result,
    quarantined: quarantined.kind,
    changed,
    whileQuarantined,
    blocked,
    events: echoEvents(h.events, from),
    stored: h.groups.pgids(),
    next: (await startTurn(h, 'echo', 'g3', 'again').result).kind,
  }).toMatchInlineSnapshot(`
    {
      "blocked": [
        {
          "kind": "turn",
          "pgid": "PGID",
          "pluginId": "echo",
          "regId": "reg-1",
          "releasable": false,
          "startedAt": "2026-01-01T00:00:00.000Z",
        },
      ],
      "changed": "ok",
      "events": [
        {
          "detail": "Cleanup failed: process group PGID is still running",
          "kind": "quarantined",
        },
        {
          "kind": "crashed",
          "reason": {
            "code": null,
            "kind": "exit",
            "signal": "SIGKILL",
          },
        },
        {
          "kind": "starting",
        },
        {
          "kind": "running",
        },
      ],
      "next": "end",
      "quarantined": "quarantined",
      "result": {
        "kind": "lost",
        "text": "hello from pid CHILD:",
      },
      "row": {
        "bootId": "boot-1",
        "generationIds": [
          "g1",
        ],
        "kind": "turn",
        "leaderStart": "LSTART",
        "pgid": "PGID",
        "pluginId": "echo",
        "regId": "reg-1",
        "startedAt": "2026-01-01T00:00:00.000Z",
      },
      "stored": [],
      "whileQuarantined": {
        "status": "quarantined",
        "worker": null,
      },
    }
  `);
});

it('lets the user Release anyway after 60 s, which un-quarantines and restarts the worker', { timeout: 20_000 }, async () => {
  const fake = fakeProbe();
  let offset = 0;
  const h = await bootHost({ probe: fake.probe, monotonicOffset: () => offset });
  const { from } = await quarantineEcho(h, fake);
  const early = h.host.releaseGroup('reg-1');
  offset = 60_000;
  const late = h.host.releaseGroup('reg-1');
  await h.untilStatus('echo', 'running', from);
  expect({ early, late, again: h.host.releaseGroup('reg-1'), stored: h.groups.pgids(), logs: h.logs.filter((line) => line.includes('released')).map((line) => line.replace(/\d+ \(/, 'PGID (')) })
    .toMatchInlineSnapshot(`
      {
        "again": "not-found",
        "early": "too-early",
        "late": "released",
        "logs": [
          "the user released group PGID (reg-1) while it was still blocked",
        ],
        "stored": [],
      }
    `);
});

it('lets a group recorded by an earlier host block only what its kind blocks', async () => {
  const fake = fakeProbe();
  const live: ProbeAnswer = { signal: 'alive', leader: GUARD };
  fake.script(500, live);
  fake.script(600, live);
  const probeOnly = await bootHost({ probe: fake.probe, rows: [groupRow(500, { kind: 'probe' })] });
  const daemon = await bootHost({ probe: fake.probe, rows: [groupRow(600, { kind: 'daemon' })] });
  expect({
    probeRow: {
      status: statuses(probeOnly.host).echo,
      info: (await probeOnly.host.info('echo', false)).kind,
      turn: (await startTurn(probeOnly, 'echo', 'g1', 'hi').result).kind,
    },
    daemonRow: {
      status: statuses(daemon.host).echo,
      info: await daemon.host.info('echo', false),
      route: await daemon.host.routeInfo('echo', daemon.workDir),
      turn: startTurn(daemon, 'echo', 'g2', 'hi').started,
      blocked: daemon.host.groups.blocked('echo'),
    },
  }).toMatchInlineSnapshot(`
    {
      "daemonRow": {
        "blocked": [
          {
            "kind": "daemon",
            "pgid": 600,
            "pluginId": "echo",
            "regId": "old-600",
            "releasable": false,
            "startedAt": "2026-01-01T00:00:00.000Z",
          },
        ],
        "info": {
          "kind": "unavailable",
          "reason": "daemon-blocked",
        },
        "route": {
          "kind": "daemon-blocked",
        },
        "status": {
          "kind": "running",
        },
        "turn": "binding-changed",
      },
      "probeRow": {
        "info": "ok",
        "status": {
          "kind": "running",
        },
        "turn": "end",
      },
    }
  `);
});
