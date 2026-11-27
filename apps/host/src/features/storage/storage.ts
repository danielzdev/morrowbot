import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { agentRepository, type AgentRepository } from './agents-repo.ts';
import { childGroupRepository, type ChildGroupRepository } from './child-groups-repo.ts';
import { folderRepository, type FolderRepository } from './folders-repo.ts';
import { generationRepository, type GenerationRepository } from './generations-repo.ts';
import { messageRepository, type MessageRepository } from './messages-repo.ts';
import { pluginSettingsRepository, type PluginSettingsRepository } from './plugins-repo.ts';
import { migrate } from './schema.ts';
import { sessionRepository, type SessionRepository } from './sessions-repo.ts';
import { threadRepository, type ThreadRepository } from './threads-repo.ts';
import { usageSnapshotRepository, type UsageSnapshotRepository } from './usage-repo.ts';

export interface Storage {
  readonly agents: AgentRepository;
  readonly folders: FolderRepository;
  readonly threads: ThreadRepository;
  readonly messages: MessageRepository;
  readonly plugins: PluginSettingsRepository;
  readonly generations: GenerationRepository;
  readonly sessions: SessionRepository;
  readonly childGroups: ChildGroupRepository;
  readonly usage: UsageSnapshotRepository;
  /** Runs `work` in one write transaction (`BEGIN IMMEDIATE`), rolled back if it throws. Not reentrant. */
  transaction<T>(work: () => T): T;
  close(): void;
}

/** Opens (and creates or upgrades) the host's SQLite database file. `now` stamps plugin setting changes. */
export function openStorage(file: string, now: () => string): Storage {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);
    return {
      agents: agentRepository(db),
      folders: folderRepository(db),
      threads: threadRepository(db),
      messages: messageRepository(db),
      plugins: pluginSettingsRepository(db, now),
      generations: generationRepository(db),
      sessions: sessionRepository(db),
      childGroups: childGroupRepository(db),
      usage: usageSnapshotRepository(db),
      transaction: (work) => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = work();
          db.exec('COMMIT');
          return result;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
      close: () => {
        db.close();
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
