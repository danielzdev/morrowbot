import type { Agent, EntityId, Folder, LastMessage } from '@morrowbot/contracts';

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

/** One agent's state across all its threads, most urgent first (as on desktop). */
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

/** The pinned section an agent shows in, or null when it stays in its folder. */
function pinnedOf(status: AgentStatus): 'needs-you' | 'working' | null {
  switch (status.kind) {
    case 'needs-approval':
    case 'needs-you':
      return 'needs-you';
    case 'working':
    case 'queued':
      return 'working';
    case 'unread':
    case 'idle':
      return null;
  }
}

/**
 * A list section: the two status sections pinned on top, agents in no folder, then each folder.
 * New kinds (such as Spaces) join this union and `sectionLabel`; the list chrome stays the same.
 */
export type Section =
  | { readonly kind: 'needs-you' }
  | { readonly kind: 'working' }
  | { readonly kind: 'agents' }
  | { readonly kind: 'folder'; readonly hostId: EntityId; readonly folder: Folder };

export function sectionKey(section: Section): string {
  return section.kind === 'folder' ? `folder:${section.hostId}/${section.folder.id}` : section.kind;
}

export function sectionLabel(section: Section): string {
  switch (section.kind) {
    case 'needs-you':
      return 'Needs you';
    case 'working':
      return 'Working';
    case 'agents':
      return 'Agents';
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
 * Each agent in exactly one section, alphabetical inside. Status sections show only when they have
 * agents; Agents and every folder always show so they can be found, except while searching.
 * Search matches the agent's name or description.
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
  const placed = items.filter((item) => pinnedOf(item.status) === null);
  const folderOf = ({ hostId, agent }: AgentItem): string | null =>
    agent.folderId !== null && folders.has(key(hostId, agent.folderId)) ? key(hostId, agent.folderId) : null;
  const groups: AgentGroup[] = [
    { section: { kind: 'needs-you' }, items: items.filter(({ status }) => pinnedOf(status) === 'needs-you').sort(byName) },
    { section: { kind: 'working' }, items: items.filter(({ status }) => pinnedOf(status) === 'working').sort(byName) },
    { section: { kind: 'agents' }, items: placed.filter((item) => folderOf(item) === null).sort(byName) },
    ...directory.folders.map(
      ({ hostId, folder }): AgentGroup => ({
        section: { kind: 'folder', hostId, folder },
        items: placed.filter((item) => folderOf(item) === key(hostId, folder.id)).sort(byName),
      }),
    ),
  ];
  return groups.filter(
    ({ section, items: inSection }) =>
      inSection.length > 0 || (wanted === '' && (section.kind === 'agents' || section.kind === 'folder')),
  );
}

/** What the row's second line says: a status that needs attention, or the last message. */
export type PreviewLine =
  | { readonly kind: 'status'; readonly text: string; readonly tone: 'warn' | 'working' }
  | { readonly kind: 'message'; readonly text: string }
  | { readonly kind: 'empty' };

/** One line of a preview: whitespace collapsed, "You: " before the user's own words. */
export function previewLine(item: AgentItem): PreviewLine {
  switch (item.status.kind) {
    case 'needs-approval':
      return { kind: 'status', text: 'Needs approval', tone: 'warn' };
    case 'needs-you':
      return { kind: 'status', text: item.status.reason === 'unbound' ? 'Needs you: choose a provider' : 'Needs you', tone: 'warn' };
    case 'working':
      return { kind: 'status', text: 'Working…', tone: 'working' };
    case 'queued':
      return { kind: 'status', text: 'Queued', tone: 'working' };
    case 'unread':
    case 'idle':
      break;
  }
  const { lastMessage } = item;
  if (lastMessage === null) return { kind: 'empty' };
  const text = lastMessage.preview.replaceAll(/\s+/g, ' ').trim();
  return { kind: 'message', text: lastMessage.kind === 'user' ? `You: ${text}` : text };
}
