import type { Agent, AgentList, LastMessage, Thread, UpdateAgentRequest } from '@morrowbot/contracts';
import type { Api, ApiResult } from '../../shared/api.ts';
import type { Loadable } from '../../shared/store.ts';

export type Saved<T> = { readonly kind: 'saved'; readonly value: T } | { readonly kind: 'refused'; readonly message: string };

export type AgentExtensionSaved =
  | { readonly kind: 'saved'; readonly agent: Agent }
  | { readonly kind: 'conflict'; readonly current: Agent }
  | { readonly kind: 'refused'; readonly message: string };

export const UNTITLED = 'New chat';

export const byNewest = (threads: readonly Thread[]): readonly Thread[] => [...threads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export function saved<T, U>(result: ApiResult<T>, pick: (value: T) => U): Saved<U> {
  return result.kind === 'ok' ? { kind: 'saved', value: pick(result.value) } : { kind: 'refused', message: result.error.message };
}

export const updateKey = (id: string, request: UpdateAgentRequest): string =>
  [id, ...[request.name, request.description, request.avatar, request.provider, request.folderId, request.emojiReplies].map((field) => field !== undefined)].join('|');

/** The agent as `request` asks for it. */
export const applied = (agent: Agent, request: UpdateAgentRequest): Agent => ({
  ...agent,
  name: request.name ?? agent.name,
  description: request.description ?? agent.description,
  avatar: request.avatar ?? agent.avatar,
  provider: request.provider ?? agent.provider,
  folderId: request.folderId === undefined ? agent.folderId : request.folderId,
  emojiReplies: request.emojiReplies ?? agent.emojiReplies,
});

/**
 * Merges `request`'s fields from `source` into `agent` while preserving other fields that may still
 * have optimistic edits in flight. Whenever `source` is at least as new as `agent`, also adopts
 * `source.disabledExtensions` and `source.revision` together so `revision` can never advance past
 * stale local `disabledExtensions`.
 */
export const withFields = (agent: Agent, request: UpdateAgentRequest, source: Agent): Agent => {
  const newer = source.revision >= agent.revision;
  return {
    ...agent,
    name: request.name === undefined ? agent.name : source.name,
    description: request.description === undefined ? agent.description : source.description,
    avatar: request.avatar === undefined ? agent.avatar : source.avatar,
    provider: request.provider === undefined ? agent.provider : source.provider,
    folderId: request.folderId === undefined ? agent.folderId : source.folderId,
    emojiReplies: request.emojiReplies === undefined ? agent.emojiReplies : source.emojiReplies,
    disabledExtensions: newer ? source.disabledExtensions : agent.disabledExtensions,
    revision: newer ? source.revision : agent.revision,
    updatedAt: newer ? source.updatedAt : agent.updatedAt,
  };
};

export const mergeMonotonicAgents = (previous: Loadable<readonly Agent[]>, incoming: readonly Agent[]): readonly Agent[] => {
  const known = new Map(previous.kind === 'loaded' ? previous.value.map((each) => [each.id, each]) : []);
  return incoming.map((each) => ((known.get(each.id)?.revision ?? -1) > each.revision ? (known.get(each.id) ?? each) : each));
};

export const clearDeletedFolder = (agents: Loadable<readonly Agent[]>, folderId: string): Partial<{ readonly agents: Loadable<readonly Agent[]> }> =>
  agents.kind === 'loaded'
    ? { agents: { kind: 'loaded', value: agents.value.map((agent) => (agent.folderId === folderId ? { ...agent, folderId: null, revision: agent.revision + 1 } : agent)) } }
    : {};

export const lastByAgent = (list: AgentList): Readonly<Record<string, LastMessage>> =>
  Object.fromEntries(list.lastMessages.map((last) => [last.agentId, last]));

export function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0]?.trim() ?? '';
  return line.length <= 48 ? line : `${line.slice(0, 47)}…`;
}

export interface ExtensionOpsDeps {
  readonly api: Api;
  readonly agentOf: (id: string) => Agent | undefined;
  readonly changeAgent: (agent: Agent) => void;
  readonly hostAgent: (id: string) => Promise<Agent | undefined>;
  readonly setSaving: (id: string, saving: boolean) => void;
}

export function createExtensionOps(deps: ExtensionOpsDeps): {
  readonly setExtensions: (id: string, disabledExtensions: readonly string[], revision: number) => Promise<AgentExtensionSaved>;
  readonly adoptAgent: (agent: Agent) => void;
} {
  return {
    setExtensions: async (id, disabledExtensions, revision) => {
      deps.setSaving(id, true);
      try {
        const result = await deps.api.updateAgent(id, { disabledExtensions: [...disabledExtensions], revision });
        if (result.kind === 'failed') {
          return result.error.kind === 'agent-conflict'
            ? { kind: 'conflict', current: result.error.current }
            : { kind: 'refused', message: result.error.message };
        }
        const now = deps.agentOf(id);
        if (now !== undefined) {
          if (result.value.revision >= now.revision) {
            deps.changeAgent(withFields(now, { disabledExtensions: result.value.disabledExtensions }, result.value));
          } else {
            const fresh = await deps.hostAgent(id);
            const latest = deps.agentOf(id);
            if (fresh !== undefined && latest !== undefined && fresh.revision >= latest.revision) {
              deps.changeAgent(withFields(latest, { disabledExtensions: fresh.disabledExtensions }, fresh));
            }
          }
        }
        return { kind: 'saved', agent: result.value };
      } finally {
        deps.setSaving(id, false);
      }
    },
    adoptAgent: (agent) => {
      const existing = deps.agentOf(agent.id);
      if (existing !== undefined && agent.revision >= existing.revision) {
        deps.changeAgent(withFields(existing, { disabledExtensions: agent.disabledExtensions }, agent));
      }
    },
  };
}
