import type { CommandExit } from './command.ts';

/**
 * A plugin's shared daemon spoken to as JSON-RPC 2.0, one message per line on its stdin and
 * stdout (Codex `app-server`, `agy acp`). Types only for now; the implementation lands with the
 * first daemon-backed provider. It starts through `openCommand` with `scope: {kind:'daemon'}`, so
 * the host registers the daemon's process group before it runs, and it is meant to be started from
 * `providerInfo`, never lazily during a turn.
 */
export interface JsonRpcProcessOptions {
  readonly args: readonly string[];
  readonly cwd: string;
  /** Extra inputs read as files, as in `CommandOptions.files`. */
  readonly files: readonly string[];
  /** Aborting stops the daemon (its guard sends SIGTERM to the group, then SIGKILL a second later). */
  readonly signal: AbortSignal;
  /** A message from the daemon without an `id`. Parse `params` with `z.looseObject`. */
  readonly onNotification: (method: string, params: unknown) => void;
  /** A request from the daemon (an approval, say); what it resolves to is sent back as the `result`. */
  readonly onRequest: (method: string, params: unknown) => Promise<unknown>;
}

/** The answer to one request. A daemon that exits fails every request still waiting with `exited`. */
export type JsonRpcReply =
  | { readonly kind: 'result'; readonly value: unknown }
  | { readonly kind: 'error'; readonly code: number; readonly message: string; readonly data: unknown }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'exited' };

export interface JsonRpcProcess {
  /** Settles once the daemon and its guard have exited. Never rejects. */
  readonly exited: Promise<CommandExit>;
  request(method: string, params: unknown, options: { readonly timeoutMs: number }): Promise<JsonRpcReply>;
  notify(method: string, params: unknown): void;
  /** Stops the daemon and resolves once it has exited. */
  close(): Promise<CommandExit>;
}

export type StartJsonRpcProcess = (command: string, options: JsonRpcProcessOptions) => JsonRpcProcess;
