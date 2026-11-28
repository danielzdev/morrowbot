import {
  AGENT_PAIR_LIMIT,
  AGENT_PAIR_WINDOW_MS,
  mainThread,
  MAX_EXCHANGE_MESSAGES,
  type AccessLevel,
  type AgentEndpoint,
  type AgentMessage,
  type SendAgentMessageRequest,
  type Thread,
} from '@morrowbot/contracts';

/** Where agent messages are kept (the storage feature provides it). */
export interface AgentMessageRecords {
  insert(message: AgentMessage): void;
  get(id: string): AgentMessage | undefined;
  hasReply(id: string): boolean;
  list(agentId: string, threadId: string | null): AgentMessage[];
}

export interface AgentMessageServiceOptions {
  readonly records: AgentMessageRecords;
  readonly agentExists: (id: string) => boolean;
  /** Whether `fromAgentId` may start messaging `toAgentId` (an agent shared with members is held to their allowlists). */
  readonly mayMessage: (fromAgentId: string, toAgentId: string) => boolean;
  /** The access an agent's turns run with, or null while it has no provider. */
  readonly accessOf: (agentId: string) => AccessLevel | null;
  readonly threads: {
    get(id: string): Thread | undefined;
    listByAgent(agentId: string): Thread[];
  };
  readonly newId: () => string;
  readonly now: () => string;
}

/** Why nothing was sent. Each refusal is a guardrail an agent cannot talk its way past. */
export type SendRefusal =
  | { readonly kind: 'not-found'; readonly what: 'Agent' | 'Recipient agent' | 'Thread' | 'Message' }
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'forbidden'; readonly reason: string }
  | { readonly kind: 'conflict'; readonly reason: string }
  | { readonly kind: 'rate-limited'; readonly reason: string };

export type SendResult = { readonly kind: 'sent'; readonly message: AgentMessage } | SendRefusal;

export interface AgentMessageService {
  /** Stores a message from `senderId` and tells listeners; refused before anything is written. */
  send(senderId: string, request: SendAgentMessageRequest): SendResult;
  /** Undefined for an unknown agent, or a thread that is not the agent's. */
  list(agentId: string, threadId: string | null): AgentMessage[] | undefined;
  subscribe(listener: (message: AgentMessage) => void): () => void;
}

type Route = { readonly kind: 'route'; readonly from: AgentEndpoint; readonly to: AgentEndpoint; readonly replyTo: AgentMessage | null } | SendRefusal;

export function createAgentMessageService(options: AgentMessageServiceOptions): AgentMessageService {
  const { records, threads } = options;
  const listeners = new Set<(message: AgentMessage) => void>();
  /** Send times per pair of agents (either way), kept apart from stored messages so deleting a chat frees no quota. */
  const sends = new Map<string, number[]>();

  /** Who the message goes from and to, checked against who is sending. */
  function route(senderId: string, request: SendAgentMessageRequest): Route {
    switch (request.kind) {
      case 'new': {
        const from = threads.get(request.fromThreadId);
        if (from?.agentId !== senderId) return { kind: 'not-found', what: 'Thread' };
        if (request.toAgentId === senderId) return { kind: 'invalid', reason: 'An agent cannot message itself' };
        if (!options.agentExists(request.toAgentId)) return { kind: 'not-found', what: 'Recipient agent' };
        if (!options.mayMessage(senderId, request.toAgentId)) {
          return { kind: 'forbidden', reason: 'This agent is shared with server members and may message only the agents its share allows' };
        }
        if (options.accessOf(request.toAgentId) === 'full' && options.accessOf(senderId) !== 'full') {
          return { kind: 'forbidden', reason: 'The recipient has full access (shell commands) and takes new messages only from agents that have full access too' };
        }
        const inbox = mainThread(threads.listByAgent(request.toAgentId));
        if (inbox === null) return { kind: 'conflict', reason: 'The recipient has no chat to receive messages yet' };
        return { kind: 'route', from: { agentId: senderId, threadId: from.id }, to: { agentId: request.toAgentId, threadId: inbox.id }, replyTo: null };
      }
      case 'reply': {
        const asked = records.get(request.replyToMessageId);
        if (asked === undefined) return { kind: 'not-found', what: 'Message' };
        if (asked.to.agentId !== senderId) return { kind: 'forbidden', reason: 'Only the agent a message was sent to can reply to it' };
        if (!asked.expectsReply) return { kind: 'conflict', reason: 'That message does not ask for a reply' };
        if (records.hasReply(asked.id)) return { kind: 'conflict', reason: 'That message already has a reply' };
        if (asked.depth + 1 >= MAX_EXCHANGE_MESSAGES) {
          return {
            kind: 'conflict',
            reason: `This exchange reached its limit of ${String(MAX_EXCHANGE_MESSAGES)} messages. Ask the user before going on.`,
          };
        }
        return { kind: 'route', from: asked.to, to: asked.from, replyTo: asked };
      }
    }
  }

  return {
    send: (senderId, request) => {
      if (!options.agentExists(senderId)) return { kind: 'not-found', what: 'Agent' };
      const routed = route(senderId, request);
      if (routed.kind !== 'route') return routed;
      const at = options.now();
      const atMs = Date.parse(at);
      const pair = [routed.from.agentId, routed.to.agentId].sort().join('\n');
      const recent = (sends.get(pair) ?? []).filter((sentAt) => atMs - sentAt < AGENT_PAIR_WINDOW_MS);
      sends.set(pair, recent);
      if (recent.length >= AGENT_PAIR_LIMIT) {
        return {
          kind: 'rate-limited',
          reason: `These agents sent each other ${String(AGENT_PAIR_LIMIT)} messages in the last ${String(AGENT_PAIR_WINDOW_MS / 60_000)} minutes. Wait, or ask the user.`,
        };
      }
      const message: AgentMessage = {
        id: options.newId(),
        from: routed.from,
        to: routed.to,
        text: request.text,
        expectsReply: request.expectsReply,
        replyToMessageId: routed.replyTo?.id ?? null,
        depth: routed.replyTo === null ? 0 : routed.replyTo.depth + 1,
        createdAt: at,
      };
      records.insert(message);
      recent.push(atMs);
      for (const listener of listeners) listener(message);
      return { kind: 'sent', message };
    },
    list: (agentId, threadId) => {
      if (!options.agentExists(agentId)) return undefined;
      if (threadId !== null && threads.get(threadId)?.agentId !== agentId) return undefined;
      return records.list(agentId, threadId);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
