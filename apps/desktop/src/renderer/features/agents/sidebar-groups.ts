import type { Agent } from '@morrowbot/contracts';

/** What the sidebar knows about one agent (spec §3.1): only provider readiness and the chats opened this session. */
export interface AgentFacts {
  readonly agent: Agent;
  /** Null until the provider's status loads; never treated as a problem. */
  readonly providerReady: boolean | null;
  /** Chats of this agent opened this session, with a pending approval. */
  readonly approvalChats: readonly string[];
  readonly failed: boolean;
  readonly working: 'running' | 'queued' | null;
  readonly unread: boolean;
  /** The newest chat's time, once this agent's chats are loaded. */
  readonly lastActive: string | null;
}

export type AgentStatus =
  | { readonly kind: 'needs-approval'; readonly threadIds: readonly string[] }
  | { readonly kind: 'needs-you'; readonly reason: 'unbound' | 'provider' | 'failed' }
  | { readonly kind: 'working' }
  | { readonly kind: 'queued' }
  | { readonly kind: 'unread' }
  | { readonly kind: 'known'; readonly lastActive: string }
  | { readonly kind: 'unknown' };

export type GroupId = 'needs-you' | 'working' | 'agents';

const ORDER: readonly GroupId[] = ['needs-you', 'working', 'agents'];

export const GROUP_LABEL: Readonly<Record<GroupId, string>> = { 'needs-you': 'Needs you', working: 'Working', agents: 'Agents' };

export interface AgentEntry {
  readonly agent: Agent;
  readonly status: AgentStatus;
}

export interface SidebarGroup {
  readonly id: GroupId;
  readonly entries: readonly AgentEntry[];
}

export function statusOf(facts: AgentFacts): AgentStatus {
  if (facts.approvalChats.length > 0) return { kind: 'needs-approval', threadIds: facts.approvalChats };
  if (facts.agent.provider.kind === 'unbound') return { kind: 'needs-you', reason: 'unbound' };
  if (facts.failed) return { kind: 'needs-you', reason: 'failed' };
  if (facts.providerReady === false) return { kind: 'needs-you', reason: 'provider' };
  if (facts.working === 'running') return { kind: 'working' };
  if (facts.working === 'queued') return { kind: 'queued' };
  if (facts.unread) return { kind: 'unread' };
  return facts.lastActive === null ? { kind: 'unknown' } : { kind: 'known', lastActive: facts.lastActive };
}

export function groupOf(status: AgentStatus): GroupId {
  switch (status.kind) {
    case 'needs-approval':
    case 'needs-you':
      return 'needs-you';
    case 'working':
    case 'queued':
      return 'working';
    case 'unread':
    case 'known':
    case 'unknown':
      return 'agents';
  }
}

const byName = (a: AgentEntry, b: AgentEntry): number =>
  a.agent.name.localeCompare(b.agent.name, undefined, { sensitivity: 'base' }) || a.agent.id.localeCompare(b.agent.id);

/** Each agent in exactly one group, in priority order, alphabetical inside; empty groups are left out. */
export function groupAgents(all: readonly AgentFacts[], filter: string): readonly SidebarGroup[] {
  const wanted = filter.trim().toLocaleLowerCase();
  const matches = (agent: Agent): boolean =>
    wanted === '' || agent.name.toLocaleLowerCase().includes(wanted) || agent.description.toLocaleLowerCase().includes(wanted);
  const entries = all.filter(({ agent }) => matches(agent)).map((facts) => ({ agent: facts.agent, status: statusOf(facts) }));
  return ORDER.map((id) => ({ id, entries: entries.filter(({ status }) => groupOf(status) === id).sort(byName) }))
    .filter(({ entries: inGroup }) => inGroup.length > 0);
}
