import type { HostMessage } from './plugin-rpc.ts';

/**
 * How the host reaches one running plugin with the wire protocol: a worker process's IPC channel,
 * or a built-in provider served inside the host's own process. Either way every message is checked
 * against `PluginMessage` / `HostMessage` on arrival.
 */
export interface PluginChannel {
  /** False once the plugin has gone (or the channel was closed). */
  readonly connected: boolean;
  /** Sends one message; `done` hears whether it was handed over. */
  send(message: HostMessage, done: (error: Error | null) => void): void;
  /**
   * Ends the plugin at once: SIGKILL for a worker, abandoning a built-in provider. Its command guards
   * see their owner pipe close and sweep their groups.
   */
  kill(): void;
}

/** What a channel tells the host about its plugin. */
export interface PluginChannelEvents {
  /** One message from the plugin, not yet checked. */
  message(raw: unknown): void;
  /** The plugin has gone, once. */
  exit(code: number | null, signal: string | null): void;
  /** `started` is false when the plugin never ran (its process could not be spawned). */
  error(error: Error, started: boolean): void;
}

/** Starts a plugin and returns its channel. */
export type OpenPluginChannel = (events: PluginChannelEvents) => PluginChannel;
