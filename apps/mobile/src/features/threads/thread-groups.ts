import { mainThread, type Agent, type EntityId, type Thread } from '@morrowbot/contracts';
import { hostKey, type Directory, type ThreadActivity } from './directory.ts';

/** The All Threads sections, top to bottom. */
export type ThreadGroupKind = 'needs-you' | 'working' | 'recent';

export const THREAD_GROUP_LABELS: Readonly<Record<ThreadGroupKind, string>> = {
  'needs-you': 'Needs you',
  working: 'Working',
  recent: 'Recent',
};

export type FolderFilter =
  | { readonly kind: 'all' }
  | { readonly kind: 'folder'; readonly hostId: EntityId; readonly folderId: EntityId };

export type AgentFilter =
  | { readonly kind: 'all' }
  | { readonly kind: 'agent'; readonly hostId: EntityId; readonly agentId: EntityId };

export interface ThreadFilter {
  readonly folder: FolderFilter;
  readonly agent: AgentFilter;
  readonly needsYouOnly: boolean;
  readonly query: string;
}

export const NO_FILTER: ThreadFilter = { folder: { kind: 'all' }, agent: { kind: 'all' }, needsYouOnly: false, query: '' };

export interface ThreadItem {
  readonly key: string;
  readonly hostId: EntityId;
  readonly thread: Thread;
  readonly activity: ThreadActivity;
  readonly agent: Agent;
  /** The agent's main chat, which the chat route names `threadId: null`. */
  readonly isMain: boolean;
}

export interface ThreadGroup {
  readonly kind: ThreadGroupKind;
  readonly items: readonly ThreadItem[];
}

export function groupOf(activity: ThreadActivity): ThreadGroupKind {
  switch (activity.kind) {
    case 'needs-approval':
    case 'failed':
      return 'needs-you';
    case 'working':
    case 'queued':
      return 'working';
    case 'unread':
    case 'idle':
      return 'recent';
  }
}

function inFolder(agent: Agent, hostId: EntityId, filter: FolderFilter): boolean {
  switch (filter.kind) {
    case 'all':
      return true;
    case 'folder':
      return hostId === filter.hostId && agent.folderId === filter.folderId;
  }
}

function isAgent(agent: Agent, hostId: EntityId, filter: AgentFilter): boolean {
  switch (filter.kind) {
    case 'all':
      return true;
    case 'agent':
      return hostId === filter.hostId && agent.id === filter.agentId;
  }
}

const newestFirst = (a: ThreadItem, b: ThreadItem): number =>
  b.thread.updatedAt.localeCompare(a.thread.updatedAt) || a.key.localeCompare(b.key);

/**
 * Every thread of every known agent that passes the filter, in Needs you, Working and Recent,
 * newest first. Empty sections are left out. Search matches the thread title or the agent name.
 */
export function groupThreads(directory: Directory, filter: ThreadFilter): readonly ThreadGroup[] {
  const agents = new Map(directory.agents.map(({ hostId, agent }) => [hostKey(hostId, agent.id), agent]));
  const mains = new Set<string>();
  const byAgent = new Map<string, Thread[]>();
  for (const { hostId, thread } of directory.threads) {
    const key = hostKey(hostId, thread.agentId);
    byAgent.set(key, [...(byAgent.get(key) ?? []), thread]);
  }
  for (const [key, threads] of byAgent) {
    const main = mainThread(threads);
    if (main) mains.add(`${key}/${main.id}`);
  }
  const wanted = filter.query.trim().toLocaleLowerCase();
  const items = directory.threads.flatMap(({ hostId, thread, activity }): ThreadItem[] => {
    const agentKey = hostKey(hostId, thread.agentId);
    const agent = agents.get(agentKey);
    if (!agent) return [];
    if (!inFolder(agent, hostId, filter.folder) || !isAgent(agent, hostId, filter.agent)) return [];
    if (filter.needsYouOnly && groupOf(activity) !== 'needs-you') return [];
    const text = `${thread.title}\n${agent.name}`.toLocaleLowerCase();
    if (wanted !== '' && !text.includes(wanted)) return [];
    const key = `${agentKey}/${thread.id}`;
    return [{ key, hostId, thread, activity, agent, isMain: mains.has(key) }];
  });
  const kinds: readonly ThreadGroupKind[] = ['needs-you', 'working', 'recent'];
  return kinds
    .map((kind) => ({ kind, items: items.filter((item) => groupOf(item.activity) === kind).sort(newestFirst) }))
    .filter(({ items: inGroup }) => inGroup.length > 0);
}

export interface Choice<T> {
  readonly label: string;
  readonly value: T;
}

const byLabel = <T>(a: Choice<T>, b: Choice<T>): number => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });

/** Names a record; the host is added only when more than one host is paired. */
function labelled(directory: Directory, hostId: EntityId, name: string): string {
  if (directory.hosts.length < 2) return name;
  const host = directory.hosts.find(({ id }) => id === hostId);
  return host ? `${name} · ${host.name}` : name;
}

export function folderChoices(directory: Directory): readonly Choice<FolderFilter>[] {
  const folders = directory.folders.map(({ hostId, folder }): Choice<FolderFilter> => ({
    label: labelled(directory, hostId, folder.name),
    value: { kind: 'folder', hostId, folderId: folder.id },
  }));
  return [{ label: 'All folders', value: { kind: 'all' } }, ...folders.sort(byLabel)];
}

export interface AgentRef {
  readonly hostId: EntityId;
  readonly agentId: EntityId;
}

/** Every agent in the folder, by name: the choices for New Thread and the agent filter. */
export function agentsIn(directory: Directory, folder: FolderFilter): readonly Choice<AgentRef>[] {
  return directory.agents
    .filter(({ hostId, agent }) => inFolder(agent, hostId, folder))
    .map(({ hostId, agent }) => ({ label: labelled(directory, hostId, agent.name), value: { hostId, agentId: agent.id } }))
    .sort(byLabel);
}

/** Agents to filter by, narrowed to the chosen folder. */
export function agentChoices(directory: Directory, folder: FolderFilter): readonly Choice<AgentFilter>[] {
  const agents = agentsIn(directory, folder).map(({ label, value }): Choice<AgentFilter> => ({ label, value: { kind: 'agent', ...value } }));
  return [{ label: 'All agents', value: { kind: 'all' } }, ...agents];
}

/** The host of the agent with this id; the first paired one when several hosts share the id. */
export function hostOfAgent(directory: Directory, agentId: EntityId): EntityId | null {
  return directory.agents.find(({ agent }) => agent.id === agentId)?.hostId ?? null;
}

/** Identifies a filter value, to compare choices and key rows. */
export function filterKey(filter: FolderFilter | AgentFilter): string {
  switch (filter.kind) {
    case 'all':
      return 'all';
    case 'folder':
      return `folder:${hostKey(filter.hostId, filter.folderId)}`;
    case 'agent':
      return `agent:${hostKey(filter.hostId, filter.agentId)}`;
  }
}

/** The label of the chosen value, or the first choice's ("All …") when it is gone. */
export function filterLabel<T extends FolderFilter | AgentFilter>(choices: readonly Choice<T>[], value: T): string {
  const chosen = choices.find((choice) => filterKey(choice.value) === filterKey(value));
  return chosen?.label ?? choices[0]?.label ?? '';
}
