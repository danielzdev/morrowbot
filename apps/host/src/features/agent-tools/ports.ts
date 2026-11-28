import type {
  AccessLevel,
  Agent,
  AgentMessage,
  BoundProvider,
  CreateMemoryRequest,
  Memory,
  SendAgentMessageRequest,
  SubagentRun,
  UpdateMemoryRequest,
} from '@morrowbot/contracts';
import type { ToolGrant } from './grants.ts';

export type SendAnswer = { readonly kind: 'sent'; readonly message: AgentMessage } | { readonly kind: 'refused'; readonly reason: string };

export type Refused = { readonly kind: 'refused'; readonly reason: string };

/** What a turn asks a sub-agent to be. Left out, the provider, model and access are the parent's. */
export interface SpawnInput {
  readonly role: string;
  readonly prompt: string;
  readonly provider: string | undefined;
  readonly model: string | undefined;
  readonly effort: string | undefined;
  readonly access: AccessLevel | undefined;
}

/** What the tools act on (the agents, agent-messages, memories and sub-agents features provide it). */
export interface ToolPorts {
  readonly agents: { list(): readonly Agent[] };
  readonly messages: {
    get(id: string): AgentMessage | undefined;
    /** Sends as `senderId`, with every guardrail of the agent-messages feature. */
    send(senderId: string, request: SendAgentMessageRequest): SendAnswer;
  };
  /** Each call is undefined (or false) for an unknown agent, or a memory that is not the agent's. */
  readonly memories: {
    list(agentId: string, query: string): Memory[] | undefined;
    create(agentId: string, request: CreateMemoryRequest): Memory | undefined;
    update(agentId: string, id: string, request: UpdateMemoryRequest): Memory | undefined;
    delete(agentId: string, id: string): boolean;
  };
  /** Each call acts as the grant's turn, with every guardrail of the sub-agents feature. */
  readonly subagents: {
    /** A sub-agent's own chat, whose turns get only the read-only tools. */
    isSubagent(threadId: string): boolean;
    spawn(grant: ToolGrant, input: SpawnInput): Promise<{ readonly kind: 'started'; readonly run: SubagentRun } | Refused>;
    wait(grant: ToolGrant, runIds: readonly string[] | undefined, timeoutMs: number): Promise<{ readonly kind: 'waited'; readonly runs: SubagentRun[]; readonly timedOut: boolean } | Refused>;
    list(grant: ToolGrant): Promise<{ readonly kind: 'listed'; readonly you: BoundProvider; readonly runs: SubagentRun[]; readonly providers: object[] } | Refused>;
  };
}
