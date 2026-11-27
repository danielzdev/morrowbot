import type {
  PluginConfig,
  PluginHealth,
  ProviderInfo,
  RouteInfo,
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
}

export interface ToolPlugin extends LifecycleHooks {
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

/** Declares a provider plugin; pass the result to `runPlugin`. */
export function defineProvider(hooks: ProviderHooks): ProviderPlugin {
  return { kind: 'provider', ...hooks };
}
