import type {
  PluginConfig,
  PluginHealth,
  PluginToolDefinition,
  PluginToolResult,
  ProviderInfo,
  RouteInfo,
  SecretFillRequest,
  SecretResolution,
  TurnChunk,
  TurnEnd,
  TurnRequest,
  UsageResult,
} from '@morrowbot/contracts';
import type { ApprovalAnswer, ApprovalAsk } from './approvals.ts';

export interface PluginContext {
  /** The plugin's settings, already checked against its manifest `settingsSchema`, with defaults filled in. */
  readonly config: PluginConfig;
  /** A folder only this plugin uses. The host creates it; it is kept between runs. */
  readonly dataDir: string;
}

export interface LifecycleHooks {
  /** Runs once after the host starts the plugin process. Throwing marks the plugin as failed. */
  init?(context: PluginContext): void | Promise<void>;
  /** Answers the host's periodic health check. Defaults to `{ kind: 'ok' }`. */
  health?(): PluginHealth | Promise<PluginHealth>;
  /** Runs before the host stops the plugin process. */
  shutdown?(): void | Promise<void>;
}

/** A message the user sent into the running turn. */
export interface Steer {
  readonly steerId: string;
  /** The user's words with a note asking the agent to answer them visibly; send it to the vendor as it is. */
  readonly text: string;
}

export interface TurnContext {
  readonly request: TurnRequest;
  /** Aborted when the host cancels the turn. Commands given this signal stop with it. */
  readonly signal: AbortSignal;
  /** Sends one piece of the turn to the host. Ignored once the turn has ended. */
  readonly emit: (chunk: TurnChunk) => void;
  /**
   * Shows the user an approval card and waits for their choice. A background turn is refused at
   * once without asking; a pending approval is refused after 30 minutes or when the turn ends.
   */
  readonly ask: (request: ApprovalAsk) => Promise<ApprovalAnswer>;
  /**
   * Takes the user's mid-turn messages. Register at the start of `turn`: a steer that arrives with no
   * handler is refused at once, and the host stops the turn and runs the message next instead. For
   * each steer the handler takes, emit `steer-delivered` once the vendor has it in the turn, or
   * `steer-refused` while none of it has reached the vendor. A steer the turn ends without
   * delivering must not have reached the vendor: the host sends it again as the next turn.
   */
  readonly onSteer: (handler: (steer: Steer) => void) => void;
}

/** One tool invocation routed from the host during an agent turn. */
export interface ToolCallContext {
  readonly turnId: string;
  readonly name: string;
  readonly input: unknown;
  /** Aborted when the host cancels the call, the turn ends, or the plugin shuts down. */
  readonly signal: AbortSignal;
  /**
   * Asks the host for one part of a Secrets Vault login, for a page on `origin`. Only plugins whose manifest lists
   * the `secrets` permission get values; the host refuses a login whose site does not match `origin`. Hand the value
   * straight to where it is used and never put it in a tool result.
   */
  readonly resolveSecret: (request: SecretFillRequest) => Promise<SecretResolution>;
}

export interface ToolHooks extends LifecycleHooks {
  /** Lists the tools this plugin exposes to agents. Called after `init`. */
  listTools?(): readonly PluginToolDefinition[] | Promise<readonly PluginToolDefinition[]>;
  /** Runs one tool call. Returning `{ kind: 'error', message }` reports a tool error to the model. */
  callTool?(context: ToolCallContext): PluginToolResult | Promise<PluginToolResult>;
}

export interface ToolPlugin extends ToolHooks {
  readonly kind: 'tool';
}

export interface ProviderHooks extends LifecycleHooks {
  /** Reports the CLI, sign-in, models and access. `refresh: false` may answer from a short display cache. */
  providerInfo(request: { readonly refresh: boolean }): ProviderInfo | Promise<ProviderInfo>;
  /** Reports plan usage. `refresh: false` reads only what this process already observed, with no network call. */
  usage(request: { readonly refresh: boolean }): UsageResult | Promise<UsageResult>;
  /** Resolves the account and inference route a turn in `cwd` would use. Never runs inference. */
  routeInfo(request: { readonly cwd: string }): RouteInfo | Promise<RouteInfo>;
  /**
   * Runs one turn. Check the account against `request.expectedAccountKey` before sending anything.
   * Throwing ends the turn as `failed{other}` (or `cancelled` once the signal is aborted).
   */
  turn(context: TurnContext): Promise<TurnEnd>;
}

export interface ProviderPlugin extends ProviderHooks {
  readonly kind: 'provider';
}

/** What a plugin implements. `kind` must match the `kind` in its `manifest.json`. */
export type PluginDefinition = ToolPlugin | ProviderPlugin;

/** Declares a tool plugin; return it from the `PluginFactory` given to `runPlugin`. */
export function defineToolPlugin(hooks: ToolHooks): ToolPlugin {
  return { kind: 'tool', ...hooks };
}

/** Declares a provider plugin; return it from the `PluginFactory` given to `runPlugin`. */
export function defineProvider(hooks: ProviderHooks): ProviderPlugin {
  return { kind: 'provider', ...hooks };
}
