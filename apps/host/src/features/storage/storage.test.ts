import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { UsageWindow } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { DataDirLockedError, lockDataDir, openStorage, type SessionKey, type Storage } from './index.ts';

const AT = '2026-01-01T00:00:00.000Z';

let dir: string;
let storage: Storage;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'oribot-storage-'));
  storage = openStorage(path.join(dir, 'nested', 'oribot.sqlite'), () => AT);
  storage.agents.insert({
    id: 'agent-1',
    name: 'Researcher',
    description: '',
    workspace: { kind: 'shared', dir: '/work' },
    avatar: { kind: 'bot', shape: 'mug', color: '#112233', finish: 'metallic' },
    provider: { kind: 'unbound' },
    folderId: null,
    emojiReplies: 'allowed',
    disabledExtensions: [],
    revision: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  for (const id of ['t1', 't2']) storage.threads.insert({ id, agentId: 'agent-1', title: id, createdAt: AT, updatedAt: AT });
});
afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

const generation = (id: string, threadId: string, startedAt = AT) => ({
  id,
  threadId,
  pluginId: 'echo',
  accountKey: 'acct',
  inputMessageId: `in-${id}`,
  startedAt,
  attemptedSessionRow: null,
  priorState: null,
});

it('keeps a generation unsettled until settle, and partial text stops at settlement', () => {
  storage.generations.insert(generation('g1', 't1'));
  storage.generations.insert(generation('g2', 't2', '2026-01-01T00:00:01.000Z'));
  storage.generations.markDispatched('g1', AT);
  storage.generations.flushPartial('g1', 'hel');
  const before = storage.generations.unsettled();
  storage.generations.settle('g1', 'reply-1');
  storage.generations.flushPartial('g1', 'too late');
  expect({
    before,
    after: storage.generations.unsettled().map((row) => row.id),
    byResult: storage.generations.byResultMessage('reply-1'),
    unknownResult: storage.generations.byResultMessage('nope'),
    t1: [...storage.generations.idsByThread('t1')],
  }).toMatchInlineSnapshot(`
    {
      "after": [
        "g2",
      ],
      "before": [
        {
          "accountKey": "acct",
          "attemptedSessionRow": null,
          "dispatched": true,
          "id": "g1",
          "inputMessageId": "in-g1",
          "partialText": "hel",
          "pluginId": "echo",
          "priorState": null,
          "startedAt": "2026-01-01T00:00:00.000Z",
          "threadId": "t1",
        },
        {
          "accountKey": "acct",
          "attemptedSessionRow": null,
          "dispatched": false,
          "id": "g2",
          "inputMessageId": "in-g2",
          "partialText": "",
          "pluginId": "echo",
          "priorState": null,
          "startedAt": "2026-01-01T00:00:01.000Z",
          "threadId": "t2",
        },
      ],
      "byResult": {
        "id": "g1",
        "inputMessageId": "in-g1",
      },
      "t1": [
        "g1",
      ],
      "unknownResult": undefined,
    }
  `);
});

it('keeps one continuation receipt per failed message', () => {
  storage.generations.insertContinuation('t1', 'failed-1', 'g1', AT);
  const duplicate = (() => {
    try {
      storage.generations.insertContinuation('t1', 'failed-1', 'g2', AT);
      return 'inserted';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  })();
  expect({
    receipt: storage.generations.continuation('t1', 'failed-1'),
    duplicate,
    otherThread: storage.generations.continuation('t2', 'failed-1'),
  }).toMatchInlineSnapshot(`
    {
      "duplicate": "UNIQUE constraint failed: continuations.thread_id, continuations.failed_message_id",
      "otherThread": undefined,
      "receipt": "g1",
    }
  `);
});

const key = (overrides: Partial<SessionKey> = {}): SessionKey => ({
  pluginId: 'echo',
  accountKey: 'acct',
  routeKey: '',
  cwd: '/work',
  threadId: 't1',
  ...overrides,
});

it('binds a session as diverged (upserting its key) and never for an unknown account', () => {
  const id = storage.sessions.bind(key(), 'ref-1', 'hash-1', 'isolated');
  storage.sessions.setState(id, 'clean');
  const clean = storage.sessions.get(id)?.state;
  const again = storage.sessions.bind(key(), 'ref-2', 'hash-2', 'personal');
  const unknown = (() => {
    try {
      return storage.sessions.bind(key({ accountKey: '' }), 'ref-x', 'hash', 'isolated');
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  })();
  expect({ sameRow: again === id, clean, row: storage.sessions.find(key()), unknown, rows: storage.sessions.listByThread('t1').length })
    .toMatchInlineSnapshot(`
      {
        "clean": "clean",
        "row": {
          "id": 1,
          "key": {
            "accountKey": "acct",
            "cwd": "/work",
            "pluginId": "echo",
            "routeKey": "",
            "threadId": "t1",
          },
          "ref": "ref-2",
          "state": "diverged",
          "systemHash": "hash-2",
          "vendorSettings": "personal",
        },
        "rows": 1,
        "sameRow": true,
        "unknown": "A session with an unknown account is never saved",
      }
    `);
});

it('marks every other session of the same thread needs-seed, and nothing else', () => {
  const rows = {
    self: key(),
    otherCwd: key({ cwd: '/elsewhere' }),
    otherRoute: key({ routeKey: 'api' }),
    otherAccount: key({ accountKey: 'acct-b' }),
    otherPlugin: key({ pluginId: 'provider-claude' }),
    otherThread: key({ threadId: 't2' }),
  };
  const ids = Object.fromEntries(Object.entries(rows).map(([name, k]) => [name, storage.sessions.bind(k, `ref-${name}`, 'h', 'isolated')]));
  for (const id of Object.values(ids)) storage.sessions.setState(id, 'clean');
  storage.sessions.markOthersNeedSeed(key());
  expect(Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, storage.sessions.get(id)?.state]))).toMatchInlineSnapshot(`
    {
      "otherAccount": "needs-seed",
      "otherCwd": "needs-seed",
      "otherPlugin": "needs-seed",
      "otherRoute": "needs-seed",
      "otherThread": "clean",
      "self": "clean",
    }
  `);
});

const usageWindow = (id: string, usedPercent: number): UsageWindow => ({
  id,
  kind: 'session',
  scope: { kind: 'account' },
  label: id,
  usedPercent,
  resetsAt: null,
  windowMinutes: null,
});

it('merges usage windows, keeping the newer observation of each window', () => {
  storage.usage.merge('echo', 'acct', '2026-01-01T00:10:00.000Z', [usageWindow('five-hour', 40)]);
  storage.usage.merge('echo', 'acct', '2026-01-01T00:05:00.000Z', [usageWindow('five-hour', 10), usageWindow('weekly', 5)]);
  storage.usage.merge('echo', '', '2026-01-01T00:20:00.000Z', [usageWindow('five-hour', 90)]);
  const read = storage.usage.read('echo', 'acct');
  expect({
    observedAt: read?.observedAt,
    windows: read?.windows.map((window) => `${window.id} ${String(window.usedPercent)}%`),
    unknownAccount: storage.usage.read('echo', ''),
  }).toMatchInlineSnapshot(`
    {
      "observedAt": "2026-01-01T00:05:00.000Z",
      "unknownAccount": undefined,
      "windows": [
        "five-hour 40%",
        "weekly 5%",
      ],
    }
  `);
});

it('records child groups with their generation links; turn groups hold their threads until deleted', () => {
  storage.generations.insert(generation('g1', 't1'));
  storage.generations.insert(generation('g2', 't2'));
  const base = { pluginId: 'echo', bootId: 'boot-1', leaderStart: 'Thu Jan  1 00:00:00 2026', startedAt: AT };
  storage.childGroups.insert({ ...base, pgid: 100, regId: 'r100', kind: 'turn', generationIds: ['g2', 'g1'] });
  storage.childGroups.insert({ ...base, pgid: 200, regId: 'r200', kind: 'probe', bootId: null, generationIds: [] });
  const listed = storage.childGroups.list();
  const held = [...storage.childGroups.heldThreads()].sort();
  storage.childGroups.delete(100);
  expect({ listed, held, heldAfterDelete: [...storage.childGroups.heldThreads()], left: storage.childGroups.list().map((row) => row.pgid) })
    .toMatchInlineSnapshot(`
      {
        "held": [
          "t1",
          "t2",
        ],
        "heldAfterDelete": [],
        "left": [
          200,
        ],
        "listed": [
          {
            "bootId": "boot-1",
            "generationIds": [
              "g1",
              "g2",
            ],
            "kind": "turn",
            "leaderStart": "Thu Jan  1 00:00:00 2026",
            "pgid": 100,
            "pluginId": "echo",
            "regId": "r100",
            "startedAt": "2026-01-01T00:00:00.000Z",
          },
          {
            "bootId": null,
            "generationIds": [],
            "kind": "probe",
            "leaderStart": "Thu Jan  1 00:00:00 2026",
            "pgid": 200,
            "pluginId": "echo",
            "regId": "r200",
            "startedAt": "2026-01-01T00:00:00.000Z",
          },
        ],
      }
    `);
});

it('links turns to a daemon group, which holds their threads until each link or the row is deleted', () => {
  storage.generations.insert(generation('g1', 't1'));
  storage.generations.insert(generation('g2', 't2'));
  storage.childGroups.insert({ pgid: 300, regId: 'r300', pluginId: 'echo', kind: 'daemon', bootId: 'boot-1', leaderStart: 'x', startedAt: AT, generationIds: [] });
  const unlinked = [...storage.childGroups.heldThreads()];
  storage.childGroups.link(300, 'g1');
  storage.childGroups.link(300, 'g2');
  const linked = { held: [...storage.childGroups.heldThreads()].sort(), links: storage.childGroups.get(300)?.generationIds };
  storage.childGroups.unlink(300, 'g1');
  const afterUnlink = { held: [...storage.childGroups.heldThreads()], links: storage.childGroups.get(300)?.generationIds };
  storage.childGroups.delete(300);
  expect({ unlinked, linked, afterUnlink, afterDelete: [...storage.childGroups.heldThreads()] }).toMatchInlineSnapshot(`
    {
      "afterDelete": [],
      "afterUnlink": {
        "held": [
          "t2",
        ],
        "links": [
          "g2",
        ],
      },
      "linked": {
        "held": [
          "t1",
          "t2",
        ],
        "links": [
          "g1",
          "g2",
        ],
      },
      "unlinked": [],
    }
  `);
});

it('round-trips a seed-truncated assistant message', () => {
  storage.messages.insert({
    kind: 'assistant',
    id: 'm1',
    threadId: 't1',
    text: 'x',
    outcome: { kind: 'interrupted' },
    attachments: [],
    seedTruncated: true,
    createdAt: AT,
  });
  expect(storage.messages.get('m1')).toMatchInlineSnapshot(`
    {
      "attachments": [],
      "createdAt": "2026-01-01T00:00:00.000Z",
      "id": "m1",
      "kind": "assistant",
      "outcome": {
        "kind": "interrupted",
      },
      "seedTruncated": true,
      "text": "x",
      "threadId": "t1",
    }
  `);
});

it('lets one host hold a data directory at a time', () => {
  const file = path.join(dir, 'host.lock');
  const first = lockDataDir(file, dir);
  const second = (() => {
    try {
      lockDataDir(file, dir).release();
      return 'locked twice';
    } catch (error) {
      return error instanceof DataDirLockedError ? error.name : String(error);
    }
  })();
  first.release();
  const third = lockDataDir(file, dir);
  third.release();
  expect(second).toMatchInlineSnapshot(`"DataDirLockedError"`);
});
