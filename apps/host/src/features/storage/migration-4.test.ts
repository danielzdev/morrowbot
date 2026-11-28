import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openStorage } from './index.ts';
import { MIGRATIONS } from './schema.ts';

const AT = '2026-01-01T00:00:00.000Z';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'oribot-migration-4-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it('reads agents saved before migration 4 as outside any folder', () => {
  const file = path.join(dir, 'oribot.sqlite');
  const db = new DatabaseSync(file);
  for (const sql of MIGRATIONS.slice(0, 3)) db.exec(sql);
  db.exec('PRAGMA user_version = 3');
  db.prepare(
    `INSERT INTO agents (id, name, description, workspace, avatar, provider, created_at, updated_at) VALUES ('gardener', 'Garden Pal', '', ?, ?, ?, ?, ?)`,
  ).run(
    JSON.stringify({ kind: 'shared', dir: '/work' }),
    JSON.stringify({ kind: 'bot', shape: 'sprout', color: '#22aa55', finish: 'matte' }),
    JSON.stringify({ kind: 'unbound' }),
    AT,
    AT,
  );
  db.close();

  const storage = openStorage(file, () => AT);
  try {
    expect(storage.agents.list().map(({ id, folderId }) => ({ id, folderId }))).toMatchInlineSnapshot(`
      [
        {
          "folderId": null,
          "id": "gardener",
        },
      ]
    `);
  } finally {
    storage.close();
  }
});
