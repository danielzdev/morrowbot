import type { ChildGroupScope } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChildGroupRegistry, type ChildGroupRow } from './child-groups.ts';
import { AT, fakeProbe, GUARD, GUARD_START, groupRow, memoryGroups, type ProbeAnswer } from './plugin-test-kit.ts';
import { isGroupGone, type GroupIdentity, type Leader } from './release-probe.ts';

const ALIVE: ProbeAnswer = { signal: 'alive', leader: GUARD };
const RECYCLED: Leader = { kind: 'process', start: 'Fri Jan  2 00:00:00 2026', args: '/usr/bin/node /sdk/command-guard.ts' };

let registries: ChildGroupRegistry[] = [];
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  for (const registry of registries) registry.close();
  registries = [];
  vi.useRealTimers();
});

/** A registry on fake timers: its monotonic clock is the faked `Date.now()`; the wall clock is separate. */
function setup(rows: readonly ChildGroupRow[] = [], bootId: string | null = 'boot-1') {
  const groups = memoryGroups(rows);
  const fake = fakeProbe(bootId);
  const logs: string[] = [];
  const released: string[] = [];
  const wall = { now: AT };
  let ids = 0;
  const registry = new ChildGroupRegistry({
    store: groups.store,
    probe: fake.probe,
    clock: { now: () => wall.now, monotonic: () => Date.now() },
    newRegId: () => `reg-${String(++ids)}`,
    log: (message) => logs.push(message),
  });
  registry.onReleased((row) => released.push(row.regId));
  registries.push(registry);
  return { registry, groups, fake, logs, released, wall };
}

const turn = (turnId: string): ChildGroupScope => ({ kind: 'turn', turnId });

async function verify(registry: ChildGroupRegistry, pgid: number): Promise<boolean> {
  const result = registry.verify(pgid);
  await vi.advanceTimersByTimeAsync(2_100);
  return result;
}

it('applies the one release predicate', async () => {
  const group: GroupIdentity = { pgid: 7, leaderStart: GUARD_START, bootId: 'boot-1' };
  const cases: Record<string, [ProbeAnswer, string | null, GroupIdentity?]> = {
    'ESRCH': [{ signal: 'gone', leader: GUARD }, 'boot-1'],
    'EPERM, our guard still leads': [{ signal: 'denied', leader: GUARD }, 'boot-1'],
    'EPERM, a recycled leader': [{ signal: 'denied', leader: RECYCLED }, 'boot-1'],
    'live, same start but not a guard': [{ signal: 'alive', leader: { kind: 'process', start: GUARD_START, args: '/bin/zsh' } }, 'boot-1'],
    'live, no leader (our orphaned group)': [{ signal: 'alive', leader: { kind: 'none' } }, 'boot-1'],
    'live, leader unreadable': [{ signal: 'alive', leader: { kind: 'unreadable' } }, 'boot-1'],
    'live, empty command line': [{ signal: 'alive', leader: { kind: 'process', start: GUARD_START, args: '' } }, 'boot-1'],
    'live, empty start time': [{ signal: 'alive', leader: { kind: 'process', start: '', args: '/bin/zsh' } }, 'boot-1'],
    'boot ids differ': [ALIVE, 'boot-2'],
    'current boot id unreadable': [ALIVE, null],
    'stored boot id unreadable': [ALIVE, 'boot-2', { ...group, bootId: null }],
  };
  const results: Record<string, string> = {};
  for (const [name, [answer, current, identity]] of Object.entries(cases)) {
    const { fake } = setup();
    fake.script(7, answer);
    results[name] = (await isGroupGone(identity ?? group, current, fake.probe)) ? 'released' : 'blocked';
  }
  expect(results).toMatchInlineSnapshot(`
    {
      "EPERM, a recycled leader": "released",
      "EPERM, our guard still leads": "blocked",
      "ESRCH": "released",
      "boot ids differ": "released",
      "current boot id unreadable": "blocked",
      "live, empty command line": "blocked",
      "live, empty start time": "blocked",
      "live, leader unreadable": "blocked",
      "live, no leader (our orphaned group)": "blocked",
      "live, same start but not a guard": "released",
      "stored boot id unreadable": "blocked",
    }
  `);
});

it('releases a row once a verified exit follows EPERM', async () => {
  const { registry, groups, fake, released } = setup();
  registry.register('echo', 1, 100, GUARD_START, turn('g1'));
  fake.script(100, { signal: 'denied', leader: GUARD }, { signal: 'denied', leader: GUARD }, { signal: 'gone', leader: { kind: 'none' } });
  expect({ verified: await verify(registry, 100), stored: groups.pgids(), released }).toMatchInlineSnapshot(`
    {
      "released": [
        "reg-1",
      ],
      "stored": [],
      "verified": true,
    }
  `);
});

it('catches a pgid reused between probes by the leader identity check', async () => {
  const { registry, groups, fake, released } = setup();
  registry.register('echo', 1, 100, GUARD_START, turn('g1'));
  fake.script(100, ALIVE, { signal: 'alive', leader: RECYCLED });
  expect({ verified: await verify(registry, 100), stored: groups.pgids(), released }).toMatchInlineSnapshot(`
    {
      "released": [
        "reg-1",
      ],
      "stored": [],
      "verified": true,
    }
  `);
});

it('keeps blocking a live group with no leader or an unreadable leader', async () => {
  const { registry, groups, fake, released } = setup();
  const answers: Record<number, ProbeAnswer> = {
    101: { signal: 'alive', leader: { kind: 'none' } },
    102: { signal: 'alive', leader: { kind: 'process', start: GUARD_START, args: '' } },
    103: { signal: 'alive', leader: { kind: 'unreadable' } },
  };
  for (const [pgid, answer] of Object.entries(answers)) {
    registry.register('echo', 1, Number(pgid), GUARD_START, turn(`g${pgid}`));
    fake.script(Number(pgid), answer);
  }
  const verified = registry.verifyWorker('echo', 1);
  await vi.advanceTimersByTimeAsync(2_100);
  expect({ stillBlocked: (await verified).map((row) => row.pgid), stored: groups.pgids(), released, blocked: registry.blocked() })
    .toMatchInlineSnapshot(`
      {
        "blocked": [
          {
            "kind": "turn",
            "pgid": 101,
            "pluginId": "echo",
            "regId": "reg-1",
            "releasable": false,
            "startedAt": "2026-01-01T00:00:00.000Z",
          },
          {
            "kind": "turn",
            "pgid": 102,
            "pluginId": "echo",
            "regId": "reg-2",
            "releasable": false,
            "startedAt": "2026-01-01T00:00:00.000Z",
          },
          {
            "kind": "turn",
            "pgid": 103,
            "pluginId": "echo",
            "regId": "reg-3",
            "releasable": false,
            "startedAt": "2026-01-01T00:00:00.000Z",
          },
        ],
        "released": [],
        "stillBlocked": [
          101,
          102,
          103,
        ],
        "stored": [
          101,
          102,
          103,
        ],
      }
    `);
});

it('allows Release anyway only after 60 s of monotonic blocked time', async () => {
  const { registry, groups, fake, released, logs, wall } = setup([groupRow(100, { startedAt: '2020-01-01T00:00:00.000Z' })]);
  fake.script(100, ALIVE);
  await registry.recover();
  registry.register('echo', 1, 200, GUARD_START, { kind: 'probe' });
  const early = { unknown: registry.releaseAnyway('nope'), live: registry.releaseAnyway('reg-1'), atBoot: registry.releaseAnyway('old-100') };
  wall.now = '2026-01-01T05:00:00.000Z';
  await vi.advanceTimersByTimeAsync(59_000);
  const at59s = { result: registry.releaseAnyway('old-100'), releasable: registry.blocked().map((group) => group.releasable) };
  await vi.advanceTimersByTimeAsync(1_000);
  const at60s = { releasable: registry.blocked().map((group) => group.releasable), result: registry.releaseAnyway('old-100') };
  expect({ early, at59s, at60s, stored: groups.pgids(), released, logs }).toMatchInlineSnapshot(`
    {
      "at59s": {
        "releasable": [
          false,
        ],
        "result": "too-early",
      },
      "at60s": {
        "releasable": [
          true,
        ],
        "result": "released",
      },
      "early": {
        "atBoot": "too-early",
        "live": "not-blocked",
        "unknown": "not-found",
      },
      "logs": [
        "the user released group 100 (old-100) while it was still blocked",
      ],
      "released": [
        "old-100",
      ],
      "stored": [
        200,
      ],
    }
  `);
});

it('ignores a late probe result for a row that was replaced or released meanwhile', async () => {
  const { registry, groups, fake, released } = setup([groupRow(100), groupRow(200)]);
  fake.script(100, ALIVE);
  fake.script(200, ALIVE);
  await registry.recover();
  const late100 = Promise.withResolvers<Leader>();
  const late200 = Promise.withResolvers<Leader>();
  fake.script(100, { signal: 'alive', leader: late100.promise });
  fake.script(200, { signal: 'alive', leader: late200.promise });
  await vi.advanceTimersByTimeAsync(2_000);
  registry.register('echo', 2, 100, GUARD_START, turn('g-new'));
  await vi.advanceTimersByTimeAsync(58_000);
  const releasedAnyway = registry.releaseAnyway('old-200');
  late100.resolve(RECYCLED);
  late200.resolve(RECYCLED);
  await vi.advanceTimersByTimeAsync(0);
  expect({ releasedAnyway, stored: groups.store.list().map((row) => row.regId), tracked: registry.row(100)?.regId, released }).toMatchInlineSnapshot(`
    {
      "released": [
        "old-100",
        "old-200",
      ],
      "releasedAnyway": "released",
      "stored": [
        "reg-1",
      ],
      "tracked": "reg-1",
    }
  `);
});

it('releases a stale row when its pgid starts a new group, in the same transaction as the insert', () => {
  const { registry, groups, released, logs } = setup();
  registry.register('echo', 1, 100, GUARD_START, turn('g1'));
  registry.register('echo', 2, 100, GUARD_START, turn('g2'));
  expect({
    stored: groups.store.list().map((row) => ({ regId: row.regId, generationIds: row.generationIds })),
    released,
    logs,
    oldButton: registry.releaseAnyway('reg-1'),
  }).toMatchInlineSnapshot(`
    {
      "logs": [
        "released stale group 100 (reg-1): its pgid now leads a new group",
      ],
      "oldButton": "not-found",
      "released": [
        "reg-1",
      ],
      "stored": [
        {
          "generationIds": [
            "g2",
          ],
          "regId": "reg-2",
        },
      ],
    }
  `);
});

it('recovers rows a previous host recorded with the same predicate', async () => {
  const { registry, groups, fake, released } = setup([
    groupRow(100, { bootId: 'boot-0' }),
    groupRow(200),
    groupRow(300),
    groupRow(400),
  ]);
  fake.script(100, ALIVE);
  fake.script(200, { signal: 'denied', leader: GUARD });
  fake.script(300, { signal: 'alive', leader: RECYCLED });
  fake.script(400, { signal: 'alive', leader: { kind: 'none' } });
  await registry.recover();
  expect({ stored: groups.pgids(), released, blocked: registry.blocked().map((group) => group.pgid) }).toMatchInlineSnapshot(`
    {
      "blocked": [
        200,
        400,
      ],
      "released": [
        "old-100",
        "old-300",
      ],
      "stored": [
        200,
        400,
      ],
    }
  `);
});

it('keeps a row blocked when the boot id is unreadable, through a wall-clock step, until the 2 s re-probe sees it exit', async () => {
  const { registry, groups, fake, released, wall } = setup([groupRow(100, { bootId: 'boot-0' })], null);
  fake.script(100, ALIVE);
  await registry.recover();
  const atBoot = groups.pgids();
  wall.now = '2027-01-01T00:00:00.000Z';
  await vi.advanceTimersByTimeAsync(2_000);
  const afterStep = { stored: groups.pgids(), releasable: registry.blocked().map((group) => group.releasable) };
  fake.script(100, { signal: 'gone', leader: { kind: 'none' } });
  await vi.advanceTimersByTimeAsync(1_999);
  const beforeReprobe = groups.pgids();
  await vi.advanceTimersByTimeAsync(1);
  expect({ atBoot, afterStep, beforeReprobe, afterReprobe: groups.pgids(), released }).toMatchInlineSnapshot(`
    {
      "afterReprobe": [],
      "afterStep": {
        "releasable": [
          false,
        ],
        "stored": [
          100,
        ],
      },
      "atBoot": [
        100,
      ],
      "beforeReprobe": [
        100,
      ],
      "released": [
        "old-100",
      ],
    }
  `);
});
