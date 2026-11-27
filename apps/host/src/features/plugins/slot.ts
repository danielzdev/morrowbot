import type { PluginStatus, ProviderInfo, TurnChunk, TurnEnd } from '@morrowbot/contracts';
import type { DiscoveredPlugin } from './discovery.ts';
import type { PluginProcess } from './plugin-process.ts';

/** Where a turn's messages go. Exactly one of `onEnd` or `onLost` is called, once. */
export interface TurnSink {
  onChunk(chunk: TurnChunk): void;
  onEnd(end: TurnEnd): void;
  /** The worker went away before `turn-end`; its process groups have been checked. Settle as interrupted. */
  onLost(): void;
}

export interface OpenTurn {
  readonly worker: number;
  readonly sink: TurnSink;
  stopTimer: NodeJS.Timeout | undefined;
}

/** One discovered plugin and its current worker process. */
export interface Slot {
  readonly plugin: DiscoveredPlugin;
  status: PluginStatus;
  process: PluginProcess | undefined;
  /** Increases with every worker start, so a queued turn can tell its worker was replaced. */
  worker: number | null;
  /** Increases with every saved settings or enable change. */
  configRevision: number;
  queue: Promise<void>;
  health: Promise<PluginStatus> | undefined;
  /** Set while a process group of this plugin cannot be confirmed gone: no new work runs. */
  quarantine: string | undefined;
  /** The current worker's last provider-info, and a fetch in flight. */
  info: { readonly worker: number; readonly value: Promise<ProviderInfo>; settled: ProviderInfo | undefined } | undefined;
  readonly turns: Map<string, OpenTurn>;
  /** Set when the host kills the worker itself (Stop on a hung turn): restart it once its groups are gone. */
  restartAfterExit: boolean;
}
