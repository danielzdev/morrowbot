import type { DatabaseSync } from 'node:sqlite';
import { MIGRATION_2 } from './migration-2.ts';
import { MIGRATION_3 } from './migration-3.ts';
import { MIGRATION_4 } from './migration-4.ts';
import { MIGRATION_5 } from './migration-5.ts';
import { MIGRATION_6 } from './migration-6.ts';
import { MIGRATION_7 } from './migration-7.ts';
import { MIGRATION_8 } from './migration-8.ts';
import { MIGRATION_9 } from './migration-9.ts';
import { MIGRATION_10 } from './migration-10.ts';
import { MIGRATION_11 } from './migration-11.ts';
import { MIGRATION_12 } from './migration-12.ts';
import { MIGRATION_13 } from './migration-13.ts';
import { MIGRATION_14 } from './migration-14.ts';

export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    workspace TEXT NOT NULL,
    avatar TEXT NOT NULL,
    provider TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX threads_by_agent ON threads(agent_id);
  CREATE TABLE messages (
    seq INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    outcome TEXT,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX messages_by_thread ON messages(thread_id, seq);
  CREATE TABLE plugin_states (
    plugin_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE plugin_configs (
    plugin_id TEXT PRIMARY KEY,
    config TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  `,
  MIGRATION_2,
  MIGRATION_3,
  MIGRATION_4,
  MIGRATION_5,
  MIGRATION_6,
  MIGRATION_7,
  MIGRATION_8,
  MIGRATION_9,
  MIGRATION_10,
  MIGRATION_11,
  MIGRATION_12,
  MIGRATION_13,
  MIGRATION_14,
];

export function migrate(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('PRAGMA user_version').get();
    const current = typeof row?.user_version === 'number' ? row.user_version : 0;
    if (current > MIGRATIONS.length) {
      throw new Error(`Database schema version ${String(current)} is newer than this host supports`);
    }
    for (const sql of MIGRATIONS.slice(current)) db.exec(sql);
    db.exec(`PRAGMA user_version = ${String(MIGRATIONS.length)}`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
