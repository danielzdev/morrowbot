import type { Agent, Folder, LastMessage } from '@morrowbot/contracts';

/** What the sidebar knows about one agent (spec §3.1): provider readiness, this session's chats, and its last message. */
export interface AgentFacts {
  readonly agent: Agent;
  /** Null until the provider's status loads; never treated as a problem. */
  readonly providerReady: boolean | null;
  /** Chats of this agent opened this session, with a pending approval. */
  readonly approvalChats: readonly string[];
  readonly failed: boolean;
  readonly working: 'running' | 'queued' | null;
  readonly unread: boolean;
  readonly lastMessage: LastMessage | null;
}

export type AgentStatus =
  | { readonly kind: 'needs-approval'; readonly threadIds: readonly string[] }
  | { readonly kind: 'needs-you'; readonly reason: 'unbound' | 'provider' | 'failed' }
  | { readonly kind: 'working' }
  | { readonly kind: 'queued' }
  | { readonly kind: 'unread' }
  | { readonly kind: 'idle' };

/** A sidebar section: the two status sections pinned on top, the agents in no folder, then each folder. */
export type Section =
  | { readonly kind: 'needs-you' }
  | { readonly kind: 'working' }
  | { readonly kind: 'agents' }
  | { readonly kind: 'folder'; readonly folder: Folder };

export const sectionKey = (section: Section): string => (section.kind === 'folder' ? `folder-${section.folder.id}` : section.kind);

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

export interface AgentEntry {
  readonly agent: Agent;
  readonly status: AgentStatus;
  readonly lastMessage: LastMessage | null;
}

export interface SidebarGroup {
  readonly section: Section;
  readonly entries: readonly AgentEntry[];
}

export function statusOf(facts: AgentFacts): AgentStatus {
  if (facts.approvalChats.length > 0) return { kind: 'needs-approval', threadIds: facts.approvalChats };
  if (facts.agent.provider.kind === 'unbound') return { kind: 'needs-you', reason: 'unbound' };
  if (facts.failed) return { kind: 'needs-you', reason: 'failed' };
  if (facts.providerReady === false) return { kind: 'needs-you', reason: 'provider' };
  if (facts.working === 'running') return { kind: 'working' };
  if (facts.working === 'queued') return { kind: 'queued' };
  return facts.unread ? { kind: 'unread' } : { kind: 'idle' };
}

/** The pinned status section an agent shows in, or null when it stays in its folder. */
export function pinnedOf(status: AgentStatus): 'needs-you' | 'working' | null {
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

const byName = (a: AgentEntry, b: AgentEntry): number =>
  a.agent.name.localeCompare(b.agent.name, undefined, { sensitivity: 'base' }) || a.agent.id.localeCompare(b.agent.id);

/**
 * Each agent in exactly one section, alphabetical inside. Status sections show only when they have
 * agents. Agents and every folder always show, so they can be found and filled, except while filtering.
 */
export function groupAgents(all: readonly AgentFacts[], folders: readonly Folder[], filter: string): readonly SidebarGroup[] {
  const wanted = filter.trim().toLocaleLowerCase();
  const matches = (agent: Agent): boolean =>
    wanted === '' || agent.name.toLocaleLowerCase().includes(wanted) || agent.description.toLocaleLowerCase().includes(wanted);
  const entries = all.filter(({ agent }) => matches(agent)).map((facts) => ({ agent: facts.agent, status: statusOf(facts), lastMessage: facts.lastMessage }));
  const known = new Set(folders.map(({ id }) => id));
  const placed = entries.filter((entry) => pinnedOf(entry.status) === null);
  const inFolder = (folderId: string | null): readonly AgentEntry[] =>
    placed.filter(({ agent }) => (agent.folderId !== null && known.has(agent.folderId) ? agent.folderId : null) === folderId).sort(byName);
  const groups: SidebarGroup[] = [
    { section: { kind: 'needs-you' }, entries: entries.filter(({ status }) => pinnedOf(status) === 'needs-you').sort(byName) },
    { section: { kind: 'working' }, entries: entries.filter(({ status }) => pinnedOf(status) === 'working').sort(byName) },
    { section: { kind: 'agents' }, entries: inFolder(null) },
    ...folders.map((folder): SidebarGroup => ({ section: { kind: 'folder', folder }, entries: inFolder(folder.id) })),
  ];
  return groups.filter(({ section, entries: inSection }) => inSection.length > 0 || (wanted === '' && (section.kind === 'agents' || section.kind === 'folder')));
}
