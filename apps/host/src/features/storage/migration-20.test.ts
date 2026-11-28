import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { MIGRATIONS } from './schema.ts';
import { openStorage } from './storage.ts';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

it('upgrades from schema 19 to 20 keeping agents with empty disabledExtensions, revision 0, and atomic conflict checks', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'orikami-m20-'));
  dirs.push(dir);
  const file = path.join(dir, 'orikami.sqlite');

  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys = ON');
  for (const sql of MIGRATIONS.slice(0, 19)) raw.exec(sql);
  raw.exec('PRAGMA user_version = 19');
  raw
    .prepare(
      `INSERT INTO agents (id, name, description, workspace, avatar, provider, folder_id, emoji_replies, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 'allowed', ?, ?)`,
    )
    .run(
      'a1',
      'Errand Bot',
      '',
      JSON.stringify({ kind: 'dedicated', dir: '/work/a1' }),
      JSON.stringify({ kind: 'bot', shape: 'chat', color: '#3b82f6', finish: 'flat' }),
      JSON.stringify({ kind: 'unbound' }),
      '2026-11-28T00:00:00.000Z',
      '2026-11-28T00:00:00.000Z',
    );
  raw.close();

  const storage = openStorage(file, () => '2026-11-28T00:01:00.000Z');
  try {
    const upgraded = storage.agents.get('a1');
    const first = storage.agents.update('a1', 0, (current) => ({ ...current, disabledExtensions: ['notes-sync'], updatedAt: '2026-11-28T00:02:00.000Z' }));
    const stale = storage.agents.update('a1', 0, (current) => ({ ...current, disabledExtensions: ['web-search'], updatedAt: '2026-11-28T00:03:00.000Z' }));
    const fresh = storage.agents.update('a1', 1, (current) => ({ ...current, disabledExtensions: [], updatedAt: '2026-11-28T00:04:00.000Z' }));

    expect({
      upgraded: upgraded ? { disabledExtensions: upgraded.disabledExtensions, revision: upgraded.revision } : null,
      first: first.kind === 'updated' ? { disabledExtensions: first.agent.disabledExtensions, revision: first.agent.revision } : first,
      stale: stale.kind === 'conflict' ? { kind: stale.kind, currentRevision: stale.current.revision, currentDisabled: stale.current.disabledExtensions } : stale,
      fresh: fresh.kind === 'updated' ? { disabledExtensions: fresh.agent.disabledExtensions, revision: fresh.agent.revision } : fresh,
      persisted: storage.agents.get('a1')?.disabledExtensions,
    }).toMatchInlineSnapshot(`
      {
        "first": {
          "disabledExtensions": [
            "notes-sync",
          ],
          "revision": 1,
        },
        "fresh": {
          "disabledExtensions": [],
          "revision": 2,
        },
        "persisted": [],
        "stale": {
          "currentDisabled": [
            "notes-sync",
          ],
          "currentRevision": 1,
          "kind": "conflict",
        },
        "upgraded": {
          "disabledExtensions": [],
          "revision": 0,
        },
      }
    `);
  } finally {
    storage.close();
  }
});
