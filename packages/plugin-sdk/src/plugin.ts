import type { FinishReason, PluginConfig, PluginHealth, ProviderStreamRequest, StreamChunk } from '@morrowbot/contracts';

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

export interface StreamSink {
  emit(chunk: StreamChunk): void;
  /** Aborted when the host cancels the stream. */
  readonly signal: AbortSignal;
}

export interface ToolPlugin extends LifecycleHooks {
  readonly kind: 'tool';
}

export interface ProviderPlugin extends LifecycleHooks {
  readonly kind: 'provider';
  /** Streams a reply as chunks and resolves with why it stopped. */
  stream(request: ProviderStreamRequest, sink: StreamSink): Promise<FinishReason>;
}

/** What a plugin implements. `kind` must match the `kind` in its `manifest.json`. */
export type PluginDefinition = ToolPlugin | ProviderPlugin;
