import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import { openStorage } from './index.ts';
import { MIGRATIONS } from './schema.ts';

const AT = '2026-01-01T00:00:00.000Z';
const LATER = '2026-01-03T00:00:00.000Z';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'morrowbot-migration-19-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it('adds queued_messages.attachment_ids and threads.archived_at, indexes active agent threads, and shields queued attachments from unsent sweeps', () => {
  const file = path.join(dir, 'morrowbot.sqlite');
  const db = new DatabaseSync(file);
  for (const sql of MIGRATIONS.slice(0, 18)) db.exec(sql);
  db.exec('PRAGMA user_version = 18');
  const workspace = JSON.stringify({ kind: 'shared', dir: '/work' });
  const avatar = JSON.stringify({ kind: 'bot', shape: 'chat', color: '#0ea5e9', finish: 'flat' });
  const provider = JSON.stringify({ kind: 'unbound' });
  db.prepare(
    `INSERT INTO agents (id, name, description, workspace, avatar, provider, created_at, updated_at) VALUES ('a1', 'Atlas', '', ?, ?, ?, ?, ?)`,
  ).run(workspace, avatar, provider, AT, AT);
  db.prepare(`INSERT INTO threads (id, agent_id, title, created_at, updated_at) VALUES ('t1', 'a1', 'Main', ?, ?)`).run(AT, AT);
  db.prepare(`INSERT INTO queued_messages (id, thread_id, text, created_at) VALUES ('q-old', 't1', 'waiting', ?)`).run(AT);
  db.close();

  const storage = openStorage(file, () => LATER);
  let snapshot: Record<string, unknown>;
  try {
    const existingQueued = storage.queued.listByThread('t1');
    storage.attachments.insert('t1', { kind: 'text', id: 'att-queued', name: 'notes.txt', size: 12 }, AT);
    storage.attachments.insert('t1', { kind: 'text', id: 'att-abandoned', name: 'stale.txt', size: 12 }, AT);
    storage.queued.insert({ id: 'q-files', threadId: 't1', text: '', attachmentIds: ['att-queued'], createdAt: AT });
    const swept = storage.attachments.deleteUnsentBefore(LATER);
    const remainingIds = [...storage.attachments.ids()].sort();
    storage.threads.setArchived('t1', LATER);
    snapshot = {
      existingQueuedAttachments: existingQueued.map((entry) => entry.attachmentIds),
      swept,
      remainingIds,
      activeAfterArchive: storage.threads.listByAgent('a1', 'active').map(({ id }) => id),
      archivedAfterArchive: storage.threads.listByAgent('a1', 'archived').map(({ id, archivedAt }) => ({ id, archivedAt })),
    };
  } finally {
    storage.close();
  }

  const check = new DatabaseSync(file);
  try {
    const plan = check
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT rowid, * FROM threads
         WHERE agent_id = ? AND parent_thread_id IS NULL AND archived_at IS NULL
         ORDER BY created_at, rowid`,
      )
      .all('a1')
      .map((row) => z.object({ detail: z.string() }).parse(row).detail);
    expect({ ...snapshot, usesIndex: plan.some((line) => line.includes('threads_by_agent_archived')) }).toMatchInlineSnapshot(`
      {
        "activeAfterArchive": [],
        "archivedAfterArchive": [
          {
            "archivedAt": "2026-01-03T00:00:00.000Z",
            "id": "t1",
          },
        ],
        "existingQueuedAttachments": [
          [],
        ],
        "remainingIds": [
          "att-queued",
        ],
        "swept": [
          "att-abandoned",
        ],
        "usesIndex": true,
      }
    `);
  } finally {
    check.close();
  }
});
