import type { Agent, EntityId, Folder, ThreadActivity as HostActivity, LastMessage, Thread } from '@morrowbot/contracts';
import type { ReadableStore } from '../../lib/store.ts';

/**
 * What the phone knows about every paired host: its agents, folders and threads, and what each
 * thread is doing right now. Ids are only unique within a host, so every record carries its host.
 */

export interface HostRecord {
  readonly id: EntityId;
  readonly name: string;
}

export interface AgentRecord {
  readonly hostId: EntityId;
  readonly agent: Agent;
}

export interface FolderRecord {
  readonly hostId: EntityId;
  readonly folder: Folder;
}

export interface LastMessageRecord {
  readonly hostId: EntityId;
  readonly message: LastMessage;
}

/** What a thread is doing, as its host last said, or `unread`: a reply came while its chat was not on screen. */
export type ThreadActivity = HostActivity | { readonly kind: 'unread' };

export interface ThreadRecord {
  readonly hostId: EntityId;
  readonly thread: Thread;
  readonly activity: ThreadActivity;
}

export interface Directory {
  readonly hosts: readonly HostRecord[];
  readonly agents: readonly AgentRecord[];
  readonly folders: readonly FolderRecord[];
  readonly lastMessages: readonly LastMessageRecord[];
  readonly threads: readonly ThreadRecord[];
}

export type CreatedThread = { readonly kind: 'created'; readonly thread: Thread } | { readonly kind: 'failed'; readonly message: string };

/** Where the lists read the directory from, and how they start a thread. */
export interface DirectorySource {
  readonly store: ReadableStore<Directory>;
  readonly createThread: (hostId: EntityId, agentId: EntityId) => Promise<CreatedThread>;
}

/** A key that stays unique across hosts, for list rows and caches. */
export function hostKey(hostId: EntityId, id: EntityId): string {
  return `${hostId}/${id}`;
}
