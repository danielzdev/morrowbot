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
  dir = await mkdtemp(path.join(tmpdir(), 'orikami-migration-3-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it('turns the initials avatars saved before migration 3 into flat chat bots of the same color', () => {
  const file = path.join(dir, 'orikami.sqlite');
  const db = new DatabaseSync(file);
  for (const sql of MIGRATIONS.slice(0, 2)) db.exec(sql);
  db.exec('PRAGMA user_version = 2');
  const insert = db.prepare(
    `INSERT INTO agents (id, name, description, workspace, avatar, provider, created_at, updated_at) VALUES (?, ?, '', ?, ?, ?, ?, ?)`,
  );
  for (const [id, color] of [['planner', '#112233'], ['writer', '#EC4899']] as const) {
    insert.run(id, id, JSON.stringify({ kind: 'shared', dir: '/work' }), JSON.stringify({ kind: 'initials', color }), JSON.stringify({ kind: 'unbound' }), AT, AT);
  }
  db.close();

  const storage = openStorage(file, () => AT);
  try {
    expect(Object.fromEntries(storage.agents.list().map((agent) => [agent.id, agent.avatar]))).toMatchInlineSnapshot(`
      {
        "planner": {
          "color": "#112233",
          "finish": "flat",
          "kind": "bot",
          "shape": "chat",
        },
        "writer": {
          "color": "#EC4899",
          "finish": "flat",
          "kind": "bot",
          "shape": "chat",
        },
      }
    `);
  } finally {
    storage.close();
  }
});
