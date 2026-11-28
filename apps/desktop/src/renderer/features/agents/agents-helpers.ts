import type { Agent, AgentList, LastMessage, Thread, UpdateAgentRequest } from '@morrowbot/contracts';
import type { ApiResult } from '../../shared/api.ts';

export type Saved<T> = { readonly kind: 'saved'; readonly value: T } | { readonly kind: 'refused'; readonly message: string };

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

/** `agent` with the fields `request` names taken from `source`; other fields, maybe still saving, stay. */
export const withFields = (agent: Agent, request: UpdateAgentRequest, source: Agent): Agent => ({
  ...agent,
  name: request.name === undefined ? agent.name : source.name,
  description: request.description === undefined ? agent.description : source.description,
  avatar: request.avatar === undefined ? agent.avatar : source.avatar,
  provider: request.provider === undefined ? agent.provider : source.provider,
  folderId: request.folderId === undefined ? agent.folderId : source.folderId,
  emojiReplies: request.emojiReplies === undefined ? agent.emojiReplies : source.emojiReplies,
});

export const lastByAgent = (list: AgentList): Readonly<Record<string, LastMessage>> =>
  Object.fromEntries(list.lastMessages.map((last) => [last.agentId, last]));

export function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0]?.trim() ?? '';
  return line.length <= 48 ? line : `${line.slice(0, 47)}…`;
}
