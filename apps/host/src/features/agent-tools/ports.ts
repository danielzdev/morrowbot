import type {
  Agent,
  AgentMessage,
  CreateMemoryRequest,
  Memory,
  PluginToolDefinition,
  PluginToolResult,
  SendAgentMessageRequest,
  UpdateMemoryRequest,
} from '@morrowbot/contracts';

export type SendAnswer = { readonly kind: 'sent'; readonly message: AgentMessage } | { readonly kind: 'refused'; readonly reason: string };

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

/** What the tools act on (the agents, agent-messages, memories and plugins features provide it). */
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
  /** Optional tool plugins bridge (absent in hosts/tests without tool plugins). */
  readonly pluginTools?: PluginToolsPort;
}
