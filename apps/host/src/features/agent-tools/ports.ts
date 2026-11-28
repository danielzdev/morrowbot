import type {
  AccessLevel,
  Agent,
  AgentMessage,
  BoundProvider,
  CreateMemoryRequest,
  Memory,
  PluginToolDefinition,
  PluginToolResult,
  SendAgentMessageRequest,
  SubagentRun,
  UpdateMemoryRequest,
  VaultItem,
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

/** One currently serving tool plugin and its declared tools. */
export interface PluginToolSource {
  readonly pluginId: string;
  readonly tools: readonly PluginToolDefinition[];
}

export type PluginToolCallOutcome =
  | { readonly kind: 'result'; readonly result: PluginToolResult }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'failed'; readonly message: string };

/** Tool plugins as the agent-tools MCP server sees them (the plugins feature provides them). */
export interface PluginToolsPort {
  /** Currently serving, enabled, unquarantined tool plugins and their tools. */
  list(): readonly PluginToolSource[];
  /**
   * Whether `agentId` is allowed to see and call tools from `pluginId` (hook for per-agent plugin
   * scoping #36). When omitted, every agent can use every enabled tool plugin.
   */
  isAllowedForAgent?(agentId: string, pluginId: string): boolean;
  /** Routes one tool call to the owning plugin worker, cancelling if `signal` aborts. */
  call(request: {
    readonly pluginId: string;
    readonly turnId: string;
    readonly name: string;
    readonly input: unknown;
    readonly signal: AbortSignal;
  }): Promise<PluginToolCallOutcome>;
}

/** A connector tool as `tools/list` shows it, named `<connector label key>__<tool>`. */
export interface ConnectorTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

/** A connector tool call's outcome: the connector server's result as it is, or why nothing was called. */
export type ConnectorCall =
  | {
      readonly kind: 'result';
      readonly content: readonly Readonly<Record<string, unknown>>[];
      readonly structuredContent: Readonly<Record<string, unknown>> | null;
      readonly isError: boolean;
    }
  | { readonly kind: 'refused'; readonly reason: string };

/** What the tools act on (the agents, agent-messages, memories, vault, sub-agents, connectors and plugins features provide it). */
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
  /** The vault's item names. Secret values never reach the tools. */
  readonly vault: { list(): readonly VaultItem[] };
  /** Each call acts as the grant's turn, with every guardrail of the sub-agents feature. */
  readonly subagents: {
    /** A sub-agent's own chat, whose turns get only the read-only tools. */
    isSubagent(threadId: string): boolean;
    spawn(grant: ToolGrant, input: SpawnInput): Promise<{ readonly kind: 'started'; readonly run: SubagentRun } | Refused>;
    wait(grant: ToolGrant, runIds: readonly string[] | undefined, timeoutMs: number): Promise<{ readonly kind: 'waited'; readonly runs: SubagentRun[]; readonly timedOut: boolean } | Refused>;
    list(grant: ToolGrant): Promise<{ readonly kind: 'listed'; readonly you: BoundProvider; readonly runs: SubagentRun[]; readonly providers: object[] } | Refused>;
  };
  /** The agent's connector tools; each list and each call checks that connector's scope and status again. */
  readonly connectors: {
    tools(agentId: string): readonly ConnectorTool[];
    call(agentId: string, name: string, args: unknown, signal: AbortSignal): Promise<ConnectorCall>;
  };
  /** Optional tool plugins bridge (absent in hosts/tests without tool plugins). */
  readonly pluginTools?: PluginToolsPort;
}
