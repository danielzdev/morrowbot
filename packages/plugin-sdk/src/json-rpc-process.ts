import { z } from 'zod';
import type { CommandExit, CommandRunner } from './command.ts';

/**
 * A plugin's shared daemon spoken to as JSON-RPC 2.0, one message per line on its stdin and
 * stdout (Codex `app-server`, `agy acp`). It starts through `PluginRuntime.openCommand` with `scope: {kind:'daemon'}`,
 * so the host registers the daemon's process group before it runs. Start it from `providerInfo`,
 * never lazily during a turn.
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
  /**
   * A request from the daemon (an approval, say); what it resolves to is sent back as the `result`.
   * A rejection is sent back as a JSON-RPC error with the rejection's message.
   */
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
  /** Sends a request. A reply that comes after `timeoutMs` is dropped. */
  request(method: string, params: unknown, options: { readonly timeoutMs: number }): Promise<JsonRpcReply>;
  notify(method: string, params: unknown): void;
  /** Stops the daemon and resolves once it has exited. */
  close(): Promise<CommandExit>;
}

export type StartJsonRpcProcess = (command: string, options: JsonRpcProcessOptions) => JsonRpcProcess;

const Id = z.union([z.number(), z.string()]);
const Incoming = z.looseObject({
  id: Id.nullish(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});
const ErrorObject = z.looseObject({ code: z.number().catch(-32603), message: z.string().catch('error'), data: z.unknown().optional() });

/** Errors this side sends back for a daemon request it could not answer. */
const INTERNAL_ERROR = -32603;

/**
 * Starts `command` as a shared daemon and speaks JSON-RPC 2.0 with it over stdin and stdout, one
 * JSON message per line. Lines that are not JSON-RPC are ignored. A handler that throws is logged
 * to stderr; it never stops the daemon, which other turns may be using.
 */
export const jsonRpcProcessOver = (open: CommandRunner['open']): StartJsonRpcProcess => (command, options) => {
  const stop = new AbortController();
  const pending = new Map<number, (reply: JsonRpcReply) => void>();
  let nextId = 0;
  let gone = false;

  const write = (message: Readonly<Record<string, unknown>>): void => {
    if (!gone) opened.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  };
  const guarded = (what: string, run: () => void): void => {
    try {
      run();
    } catch (error) {
      console.error(`MorrowBot jsonRpcProcess: the ${what} handler threw: ${describe(error)}`);
    }
  };
  const answer = (id: number | string, method: string, params: unknown): void => {
    let reply: Promise<unknown>;
    try {
      reply = options.onRequest(method, params);
    } catch (error) {
      reply = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    reply.then(
      (result) => {
        guarded(`${method} reply`, () => {
          write({ id, result: result ?? null });
        });
      },
      (error: unknown) => {
        guarded(`${method} error reply`, () => {
          write({ id, error: { code: INTERNAL_ERROR, message: describe(error) } });
        });
      },
    );
  };
  const read = (line: string): void => {
    if (line.trim() === '') return;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      return;
    }
    const parsed = Incoming.safeParse(json);
    if (!parsed.success) return;
    const { id, method, params, error, result } = parsed.data;
    if (method !== undefined) {
      if (id !== undefined && id !== null) answer(id, method, params);
      else guarded(`"${method}" notification`, () => { options.onNotification(method, params); });
      return;
    }
    if (typeof id !== 'number') return;
    const failed = error === undefined || error === null ? null : ErrorObject.safeParse(error);
    if (failed === null && !Object.hasOwn(parsed.data, 'result')) return;
    const settle = pending.get(id);
    if (settle === undefined) return;
    pending.delete(id);
    if (failed === null) settle({ kind: 'result', value: result });
    else if (failed.success) settle({ kind: 'error', code: failed.data.code, message: failed.data.message, data: failed.data.data });
    else settle({ kind: 'error', code: INTERNAL_ERROR, message: 'malformed error reply', data: undefined });
  };

  const opened = open(command, {
    args: options.args,
    cwd: options.cwd,
    files: options.files,
    scope: { kind: 'daemon' },
    signal: AbortSignal.any([options.signal, stop.signal]),
    onLine: read,
  });
  const exited = opened.exited.then((exit) => {
    gone = true;
    for (const settle of pending.values()) settle({ kind: 'exited' });
    pending.clear();
    return exit;
  });

  return {
    exited,
    request: (method, params, { timeoutMs }) => {
      if (gone) return Promise.resolve({ kind: 'exited' });
      const id = nextId++;
      const { promise, resolve } = Promise.withResolvers<JsonRpcReply>();
      const timer = setTimeout(() => {
        if (pending.delete(id)) resolve({ kind: 'timeout' });
      }, timeoutMs);
      timer.unref();
      pending.set(id, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      write({ id, method, params });
      return promise;
    },
    notify: (method, params) => {
      write({ method, params });
    },
    close: () => {
      stop.abort();
      return exited;
    },
  };
};

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
