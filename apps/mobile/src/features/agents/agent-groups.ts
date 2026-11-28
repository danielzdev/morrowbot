import type { Agent, EntityId, Folder, LastMessage } from '@morrowbot/contracts';
import type { RowIndicator } from '../../lib/RowIndicator.tsx';

/**
 * The slice of the host directory the Agents list reads. `features/threads` owns the directory;
 * the app passes it here, so this list only names the fields it uses.
 */
export type ThreadActivityKind = 'needs-approval' | 'failed' | 'working' | 'queued' | 'unread' | 'idle';

export interface AgentsDirectory {
  readonly hosts: readonly { readonly id: EntityId; readonly name: string }[];
  readonly agents: readonly { readonly hostId: EntityId; readonly agent: Agent }[];
  readonly folders: readonly { readonly hostId: EntityId; readonly folder: Folder }[];
  readonly lastMessages: readonly { readonly hostId: EntityId; readonly message: LastMessage }[];
  readonly threads: readonly {
    readonly hostId: EntityId;
    readonly thread: { readonly agentId: EntityId };
    readonly activity: { readonly kind: ThreadActivityKind };
  }[];
}

/** One agent's state across all its threads, the most urgent one winning. */
export type AgentStatus =
  | { readonly kind: 'needs-approval' }
  | { readonly kind: 'needs-you'; readonly reason: 'unbound' | 'failed' }
  | { readonly kind: 'working' }
  | { readonly kind: 'queued' }
  | { readonly kind: 'unread' }
  | { readonly kind: 'idle' };

export function agentStatus(agent: Agent, activities: readonly ThreadActivityKind[]): AgentStatus {
  const has = (kind: ThreadActivityKind): boolean => activities.includes(kind);
  if (has('needs-approval')) return { kind: 'needs-approval' };
  if (agent.provider.kind === 'unbound') return { kind: 'needs-you', reason: 'unbound' };
  if (has('failed')) return { kind: 'needs-you', reason: 'failed' };
  if (has('working')) return { kind: 'working' };
  if (has('queued')) return { kind: 'queued' };
  return has('unread') ? { kind: 'unread' } : { kind: 'idle' };
}

/**
 * A list section: agents in no folder (shown without a header), then each folder. New kinds (such
 * as Spaces) join this union and `sectionLabel`; the list chrome stays the same.
 */
export type Section =
  | { readonly kind: 'unfiled' }
  | { readonly kind: 'folder'; readonly hostId: EntityId; readonly folder: Folder };

export function sectionKey(section: Section): string {
  return section.kind === 'folder' ? `folder:${section.hostId}/${section.folder.id}` : section.kind;
}

/** The section's header text, or null for a section drawn without a header. */
export function sectionLabel(section: Section): string | null {
  switch (section.kind) {
    case 'unfiled':
      return null;
    case 'folder':
      return section.folder.name;
  }
}

export interface AgentItem {
  readonly key: string;
  readonly hostId: EntityId;
  readonly agent: Agent;
  readonly status: AgentStatus;
  readonly lastMessage: LastMessage | null;
}

export interface AgentGroup {
  readonly section: Section;
  readonly items: readonly AgentItem[];
}

const byName = (a: AgentItem, b: AgentItem): number =>
  a.agent.name.localeCompare(b.agent.name, undefined, { sensitivity: 'base' }) || a.key.localeCompare(b.key);

/**
 * Each agent in its home: unfiled agents first, then each folder, alphabetical inside. Status never
 * moves an agent; the row shows it instead. Empty folders show (so they can be found) except while
 * searching. Search matches the agent's name or description.
 */
export function groupAgents(directory: AgentsDirectory, query: string): readonly AgentGroup[] {
  const key = (hostId: EntityId, id: EntityId): string => `${hostId}/${id}`;
  const activities = new Map<string, ThreadActivityKind[]>();
  for (const { hostId, thread, activity } of directory.threads) {
    const agentKey = key(hostId, thread.agentId);
    activities.set(agentKey, [...(activities.get(agentKey) ?? []), activity.kind]);
  }
  const latest = new Map<string, LastMessage>();
  for (const { hostId, message } of directory.lastMessages) {
    const agentKey = key(hostId, message.agentId);
    const known = latest.get(agentKey);
    if (!known || known.at < message.at) latest.set(agentKey, message);
  }
  const wanted = query.trim().toLocaleLowerCase();
  const items = directory.agents
    .filter(({ agent }) => wanted === '' || `${agent.name}\n${agent.description}`.toLocaleLowerCase().includes(wanted))
    .map(({ hostId, agent }): AgentItem => {
      const agentKey = key(hostId, agent.id);
      return {
        key: agentKey,
        hostId,
        agent,
        status: agentStatus(agent, activities.get(agentKey) ?? []),
        lastMessage: latest.get(agentKey) ?? null,
      };
    });
  const folders = new Set(directory.folders.map(({ hostId, folder }) => key(hostId, folder.id)));
  const folderOf = ({ hostId, agent }: AgentItem): string | null =>
    agent.folderId !== null && folders.has(key(hostId, agent.folderId)) ? key(hostId, agent.folderId) : null;
  const groups: AgentGroup[] = [
    { section: { kind: 'unfiled' }, items: items.filter((item) => folderOf(item) === null).sort(byName) },
    ...directory.folders.map(
      ({ hostId, folder }): AgentGroup => ({
        section: { kind: 'folder', hostId, folder },
        items: items.filter((item) => folderOf(item) === key(hostId, folder.id)).sort(byName),
      }),
    ),
  ];
  return groups.filter(({ section, items: inSection }) => inSection.length > 0 || (wanted === '' && section.kind === 'folder'));
}

/** The row's second line: the newest message on one line, "You: " before the user's own words. */
export function previewText(lastMessage: LastMessage | null): string | null {
  if (lastMessage === null) return null;
  const text = lastMessage.preview.replaceAll(/\s+/g, ' ').trim();
  return lastMessage.kind === 'user' ? `You: ${text}` : text;
}

/** The row's badge when the agent needs you, a dot when unread, dots while working. */
export function agentIndicator(status: AgentStatus): RowIndicator {
  switch (status.kind) {
    case 'needs-approval':
      return { kind: 'badge', label: 'Needs approval', tone: 'warn' };
    case 'needs-you':
      return status.reason === 'unbound'
        ? { kind: 'badge', label: 'No provider', tone: 'warn' }
        : { kind: 'badge', label: 'Error', tone: 'danger' };
    case 'working':
      return { kind: 'working', label: 'Working', animated: true };
    case 'queued':
      return { kind: 'working', label: 'Queued', animated: false };
    case 'unread':
      return { kind: 'unread' };
    case 'idle':
      return { kind: 'none' };
  }
}
