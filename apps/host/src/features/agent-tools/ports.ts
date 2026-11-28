import type {
  AccessLevel,
  Agent,
  AgentMessage,
  BoundProvider,
  CreateMemoryRequest,
  CreateRoutineRequest,
  Memory,
  PluginToolDefinition,
  PluginToolResult,
  ReplyAttachment,
  Routine,
  SendAgentMessageRequest,
  SubagentRun,
  T3Watch,
  T3WatchAck,
  T3WatchEvent,
  UpdateMemoryRequest,
  UpdateRoutineRequest,
  VaultItem,
} from '@morrowbot/contracts';
import type { ToolGrant } from './grants.ts';

export type SendAnswer = { readonly kind: 'sent'; readonly message: AgentMessage } | { readonly kind: 'refused'; readonly reason: string };

/** A reply tool's outcome: a JSON value for the model, or why nothing was done. */
export type ReplyAnswer = { readonly kind: 'done'; readonly value: object } | { readonly kind: 'refused'; readonly reason: string };

/** What `attach_files` did with each path. */
export interface AttachAnswer {
  readonly attached: readonly ReplyAttachment[];
  readonly refused: readonly { readonly path: string; readonly reason: string }[];
}

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

export type RoutineSaveResult =
  | { readonly kind: 'saved'; readonly routine: Routine }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'invalid'; readonly reason: string };

export type RoutineNoUpdateResult =
  | { readonly kind: 'marked'; readonly routineId: string; readonly runId: string }
  | { readonly kind: 'not-a-routine-run' };

/** Routines scoped to the calling agent (provided by the routines feature). */
export interface RoutineToolsPort {
  sharedWithMembers(agentId: string): boolean;
  list(agentId: string): Routine[] | undefined;
  create(request: CreateRoutineRequest): RoutineSaveResult;
  update(agentId: string, routineId: string, request: UpdateRoutineRequest): RoutineSaveResult;
  delete(agentId: string, routineId: string): boolean;
  markNoUpdate(agentId: string, threadId: string): RoutineNoUpdateResult;
}

export type T3WatchView = T3Watch & { readonly routineId: string | null };

export interface T3PendingBatchView {
  readonly batchId: string;
  readonly createdAt: string;
  readonly attempts: number;
  readonly resendAt: string;
  readonly events: readonly { readonly event: T3WatchEvent; readonly unverified: boolean }[];
}

export interface T3WatchListView {
  readonly watches: readonly T3WatchView[];
  readonly pendingBatches: readonly T3PendingBatchView[];
  readonly pendingEvents: readonly T3WatchEvent[];
}

export interface WatchT3Request {
  readonly threadId: string;
  readonly routineId: string;
  readonly runId?: string;
  readonly priorRunId?: string;
  readonly exclusive: boolean;
  readonly label?: string;
  readonly launchedAt?: string;
  readonly stallAfterMin?: number;
}

export type WatchT3Result =
  | { readonly kind: 'watched'; readonly watch: T3WatchView }
  | { readonly kind: 'refused'; readonly reason: string };

export type UnwatchT3Result =
  | { readonly kind: 'unwatched'; readonly threadId: string; readonly removedWatchIds: readonly string[] }
  | { readonly kind: 'not-found' };

export type T3AckResult =
  | { readonly kind: 'acked' }
  | { readonly kind: 'already_acked' }
  | { readonly kind: 'unknown_batch' };

/** T3 Code watches scoped to the calling agent (provided by the t3-watch feature). */
export interface T3WatchToolsPort {
  sharedWithMembers(agentId: string): boolean;
  list(agentId: string, includeSettled: boolean): T3WatchListView;
  watch(agentId: string, request: WatchT3Request): WatchT3Result;
  unwatch(agentId: string, target: { readonly threadId?: string; readonly watchId?: string }): UnwatchT3Result;
  ack(agentId: string, ack: T3WatchAck): T3AckResult;
}

/** What the tools act on (the agents, agent-messages, memories, chat, vault, routines, t3-watch, sub-agents, connectors and plugins features provide it). */
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
  /** The running turn `grant` stands for, in its chat. */
  readonly replies: {
    react(grant: ToolGrant, emoji: string): ReplyAnswer;
    stayQuiet(grant: ToolGrant): ReplyAnswer;
  };
  /** Files for the reply of the turn `grant` stands for (the attachments feature provides it). */
  readonly replyAttachments: {
    attach(grant: ToolGrant, paths: readonly string[], signal: AbortSignal): Promise<AttachAnswer>;
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
  /** Optional routines bridge (absent in focused tests without routines). */
  readonly routines?: RoutineToolsPort;
  /** Optional T3 Code watches bridge (absent in focused tests without T3 watches). */
  readonly t3Watches?: T3WatchToolsPort;
  /** Optional tool plugins bridge (absent in hosts/tests without tool plugins). */
  readonly pluginTools?: PluginToolsPort;
}
