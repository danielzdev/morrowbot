import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { agentMessageRepository, type AgentMessageRepository } from './agent-messages-repo.ts';
import { agentRepository, type AgentRepository } from './agents-repo.ts';
import { attachmentRepository, type AttachmentRepository } from './attachments-repo.ts';
import { chatSettingsRepository, type ChatSettingsRepository } from './chat-settings-repo.ts';
import { childGroupRepository, type ChildGroupRepository } from './child-groups-repo.ts';
import { connectorRepository, type ConnectorRepository } from './connectors-repo.ts';
import { deviceRepository, type DeviceRepository } from './devices-repo.ts';
import { folderRepository, type FolderRepository } from './folders-repo.ts';
import { generationRepository, type GenerationRepository } from './generations-repo.ts';
import { memberRepository, type MemberRepository } from './members-repo.ts';
import { memoryRepository, type MemoryRepository } from './memories-repo.ts';
import { messageRepository, type MessageRepository } from './messages-repo.ts';
import { pluginSettingsRepository, type PluginSettingsRepository } from './plugins-repo.ts';
import { queuedRepository, type QueuedRepository } from './queued-repo.ts';
import { reactionRepository, type ReactionRepository } from './reactions-repo.ts';
import { routineRunRepository, type RoutineRunRepository } from './routine-runs-repo.ts';
import { routineRepository, type RoutineRepository } from './routines-repo.ts';
import { migrate } from './schema.ts';
import { sessionRepository, type SessionRepository } from './sessions-repo.ts';
import { t3BatchRepository, type T3BatchRepository } from './t3-batches-repo.ts';
import { t3OutboxRepository, type T3OutboxRepository } from './t3-outbox-repo.ts';
import { t3WatchRepository, type T3WatchRepository } from './t3-watches-repo.ts';
import { threadRepository, type ThreadRepository } from './threads-repo.ts';
import { tokenTotalsRepository, type TokenTotalsRepository } from './token-totals-repo.ts';
import { usageSnapshotRepository, type UsageSnapshotRepository } from './usage-repo.ts';
import { waitRepository, type WaitRepository } from './waits-repo.ts';

export interface Storage {
  readonly agents: AgentRepository;
  readonly folders: FolderRepository;
  readonly threads: ThreadRepository;
  readonly messages: MessageRepository;
  readonly reactions: ReactionRepository;
  readonly chatSettings: ChatSettingsRepository;
  readonly queued: QueuedRepository;
  readonly plugins: PluginSettingsRepository;
  readonly generations: GenerationRepository;
  readonly sessions: SessionRepository;
  readonly childGroups: ChildGroupRepository;
  readonly usage: UsageSnapshotRepository;
  readonly tokens: TokenTotalsRepository;
  readonly devices: DeviceRepository;
  readonly members: MemberRepository;
  readonly attachments: AttachmentRepository;
  readonly memories: MemoryRepository;
  readonly agentMessages: AgentMessageRepository;
  readonly routines: RoutineRepository;
  readonly routineRuns: RoutineRunRepository;
  readonly waits: WaitRepository;
  readonly t3Watches: T3WatchRepository;
  readonly t3Outbox: T3OutboxRepository;
  readonly t3Batches: T3BatchRepository;
  readonly connectors: ConnectorRepository;
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
      reactions: reactionRepository(db),
      chatSettings: chatSettingsRepository(db),
      queued: queuedRepository(db),
      plugins: pluginSettingsRepository(db, now),
      generations: generationRepository(db),
      sessions: sessionRepository(db),
      childGroups: childGroupRepository(db),
      usage: usageSnapshotRepository(db),
      tokens: tokenTotalsRepository(db, now),
      devices: deviceRepository(db),
      members: memberRepository(db),
      attachments: attachmentRepository(db),
      memories: memoryRepository(db),
      agentMessages: agentMessageRepository(db),
      routines: routineRepository(db),
      routineRuns: routineRunRepository(db),
      waits: waitRepository(db),
      t3Watches: t3WatchRepository(db),
      t3Outbox: t3OutboxRepository(db),
      t3Batches: t3BatchRepository(db),
      connectors: connectorRepository(db),
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
