import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import { openStorage } from './index.ts';
import { MIGRATIONS } from './schema.ts';

const AT = '2026-01-01T00:00:00.000Z';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'morrowbot-migration-17-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it('adds agent_messages.read_outcome (backfilling settled reads as status only) and indexes generations.input_message_id', () => {
  const file = path.join(dir, 'morrowbot.sqlite');
  const db = new DatabaseSync(file);
  for (const sql of MIGRATIONS.slice(0, 16)) db.exec(sql);
  db.exec('PRAGMA user_version = 16');
  const workspace = JSON.stringify({ kind: 'shared', dir: '/work' });
  const avatar = JSON.stringify({ kind: 'bot', shape: 'chat', color: '#112233', finish: 'flat' });
  const provider = JSON.stringify({ kind: 'unbound' });
  const insertAgent = db.prepare(
    `INSERT INTO agents (id, name, description, workspace, avatar, provider, created_at, updated_at) VALUES (?, ?, '', ?, ?, ?, ?, ?)`,
  );
  insertAgent.run('a1', 'Lead', workspace, avatar, provider, AT, AT);
  insertAgent.run('a2', 'Helper', workspace, avatar, provider, AT, AT);
  const insertThread = db.prepare(`INSERT INTO threads (id, agent_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`);
  insertThread.run('t1', 'a1', 'Main', AT, AT);
  insertThread.run('t2', 'a2', 'Main', AT, AT);
  const insertMessage = db.prepare(
    `INSERT INTO agent_messages (id, from_agent_id, from_thread_id, to_agent_id, to_thread_id, text, expects_reply, reply_to_message_id, depth, created_at)
     VALUES (?, 'a1', 't1', 'a2', 't2', ?, 0, NULL, 0, ?)`,
  );
  insertMessage.run('m-failed', 'Check build', AT);
  insertMessage.run('m-unread', 'Still waiting', '2026-01-01T00:00:01.000Z');
  db.prepare(
    `INSERT INTO generations (id, thread_id, plugin_id, account_key, input_message_id, started_at, dispatched_at, settled)
     VALUES ('g1', 't2', 'echo', 'acct', 'm-failed', ?, ?, 1)`,
  ).run(AT, AT);
  db.prepare(
    `INSERT INTO turn_usage (generation_id, agent_id, thread_id, plugin_id, account_key, outcome, created_at)
     VALUES ('g1', 'a2', 't2', 'echo', 'acct', ?, ?)`,
  ).run(JSON.stringify({ kind: 'failed', error: { kind: 'other', message: 'provider boom' } }), AT);
  db.close();

  const storage = openStorage(file, () => AT);
  let migrated: Record<string, unknown>;
  try {
    migrated = {
      failedOutcome: storage.agentMessages.get('m-failed')?.readOutcome,
      unreadOutcome: storage.agentMessages.get('m-unread')?.readOutcome,
      unreadWaiting: storage.agentMessages.waiting('t2').map(({ id }) => id),
    };
  } finally {
    storage.close();
  }

  const check = new DatabaseSync(file);
  try {
    const plan = check
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT * FROM agent_messages AS message
         WHERE NOT EXISTS (SELECT 1 FROM generations WHERE generations.input_message_id = message.id)
           AND to_thread_id = ?
         ORDER BY created_at, rowid`,
      )
      .all('t2')
      .map((row) => z.object({ detail: z.string() }).parse(row).detail);
    expect({ ...migrated, usesIndex: plan.some((line) => line.includes('generations_by_input_message')) }).toMatchInlineSnapshot(`
      {
        "failedOutcome": "failed",
        "unreadOutcome": undefined,
        "unreadWaiting": [
          "m-unread",
        ],
        "usesIndex": true,
      }
    `);
  } finally {
    check.close();
  }
});
