import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { agentRepository, type AgentRepository } from './agents-repo.ts';
import { messageRepository, type MessageRepository } from './messages-repo.ts';
import { pluginSettingsRepository, type PluginSettingsRepository } from './plugins-repo.ts';
import { migrate } from './schema.ts';
import { threadRepository, type ThreadRepository } from './threads-repo.ts';

export interface Storage {
  readonly agents: AgentRepository;
  readonly threads: ThreadRepository;
  readonly messages: MessageRepository;
  readonly plugins: PluginSettingsRepository;
  close(): void;
}

/** Opens (and creates or upgrades) the host's SQLite database file. */
export function openStorage(file: string): Storage {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    migrate(db);
    return {
      agents: agentRepository(db),
      threads: threadRepository(db),
      messages: messageRepository(db),
      plugins: pluginSettingsRepository(db),
      close: () => {
        db.close();
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
