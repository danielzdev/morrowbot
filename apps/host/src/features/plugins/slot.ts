import type { PluginStatus, ProviderInfo, TurnChunk, TurnEnd } from '@morrowbot/contracts';
import type { PluginSource } from './discovery.ts';
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

/** A provider-info request of one worker, and its answer once it settled. `askedAt` is on the monotonic clock. */
export interface InfoEntry {
  readonly worker: number;
  /** The daemon revision it was asked under: an answer from an older revision is never published. */
  readonly revision: number;
  readonly askedAt: number;
  readonly refresh: boolean;
  readonly value: Promise<ProviderInfo>;
  settled: ProviderInfo | undefined;
  done: boolean;
}

/** One plugin (a folder or a built-in provider) and its current worker. */
export interface Slot {
  readonly plugin: PluginSource;
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
  /** The current worker's last provider-info, or a fetch in flight. */
  info: InfoEntry | undefined;
  /**
   * Increases whenever the plugin's daemon is retired or exits, and when Recheck starts. Work
   * admitted under an older revision is refused, and answers asked under one are discarded.
   */
  daemonRevision: number;
  /** The plugin's daemon went away: the next provider-info asks `refresh: true`, which starts a new one. */
  daemonLost: boolean;
  /** Set while a daemon is retired or an exited one is checked: provider-info and Recheck wait, so no replacement starts before it is gone. */
  daemonGone: Promise<void> | undefined;
  /** During Recheck only Recheck asks provider-info (and so starts a daemon). */
  rechecking: boolean;
  /** Daemon groups being retired, each resolved when the plugin reports the group's guard gone. */
  readonly retiring: Map<number, PromiseWithResolvers<undefined>>;
  readonly turns: Map<string, OpenTurn>;
  /** Set when the host kills the worker itself (Stop on a hung turn): restart it once its groups are gone. */
  restartAfterExit: boolean;
  /** Settles once the last worker has exited and its groups were checked (a worker never starts before). */
  retired: Promise<void>;
}

export function newSlot(plugin: PluginSource, status: PluginStatus): Slot {
  return {
    plugin,
    status,
    process: undefined,
    worker: null,
    configRevision: 0,
    queue: Promise.resolve(),
    health: undefined,
    quarantine: undefined,
    info: undefined,
    daemonRevision: 0,
    daemonLost: false,
    daemonGone: undefined,
    rechecking: false,
    retiring: new Map(),
    turns: new Map(),
    restartAfterExit: false,
    retired: Promise.resolve(),
  };
}
