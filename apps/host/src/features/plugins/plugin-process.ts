import { fork } from 'node:child_process';
import {
  PluginMessage,
  type CrashReason,
  type FinishReason,
  type HostMessage,
  type PluginConfig,
  type PluginErrorCode,
  type PluginHealth,
  type PluginKind,
  type ProviderStreamRequest,
  type StreamChunk,
} from '@morrowbot/contracts';
import { describeIssues } from './issues.ts';

export interface PluginTimeouts {
  readonly initMs: number;
  readonly healthMs: number;
  readonly shutdownMs: number;
}

export type PluginExit = { readonly kind: 'expected' } | { readonly kind: 'crashed'; readonly reason: CrashReason };

/** The plugin answered a request with an error. Its process is still running. */
export class PluginRequestError extends Error {
  readonly code: PluginErrorCode;

  constructor(code: PluginErrorCode, message: string) {
    super(message);
    this.name = 'PluginRequestError';
    this.code = code;
  }
}

/** The plugin process stopped before it answered. */
export class PluginGoneError extends Error {
  constructor() {
    super('The plugin process stopped before it answered');
    this.name = 'PluginGoneError';
  }
}

export interface PluginProcess {
  readonly pid: number | undefined;
  /** Settles once, when the process is gone. */
  readonly exited: Promise<PluginExit>;
  init(config: PluginConfig): Promise<PluginKind>;
  health(): Promise<PluginHealth>;
  stream(request: ProviderStreamRequest, onChunk: (chunk: StreamChunk) => void, signal?: AbortSignal): Promise<FinishReason>;
  /** Asks the plugin to shut down, then kills it if it has not exited within the shutdown timeout. */
  stop(): Promise<void>;
}

interface Waiter {
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout | undefined;
}

type Variant =
  | { readonly kind: 'init'; readonly resolve: (kind: PluginKind) => void }
  | { readonly kind: 'health'; readonly resolve: (health: PluginHealth) => void }
  | { readonly kind: 'shutdown'; readonly resolve: () => void }
  | {
      readonly kind: 'stream';
      readonly resolve: (reason: FinishReason) => void;
      readonly onChunk: (chunk: StreamChunk) => void;
    };

type Pending = Waiter & Variant;

export interface SpawnOptions {
  readonly entryPath: string;
  readonly cwd: string;
  readonly timeouts: PluginTimeouts;
}

/** Starts a plugin in its own Node process and talks to it over IPC. */
export function spawnPluginProcess({ entryPath, cwd, timeouts }: SpawnOptions): PluginProcess {
  const child = fork(entryPath, [], {
    cwd,
    execArgv: [],
    env: { PATH: process.env.PATH ?? '' },
    serialization: 'json',
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  const pending = new Map<number, Pending>();
  const exit = Promise.withResolvers<PluginExit>();
  let nextId = 0;
  let stopping = false;
  let failure: CrashReason | undefined;
  let gone = false;
  let killer: NodeJS.Timeout | undefined;
  const abandoned = new Set<number>();

  function finish(result: PluginExit): void {
    if (gone) return;
    gone = true;
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new PluginGoneError());
    }
    pending.clear();
    abandoned.clear();
    exit.resolve(result);
  }

  function fail(reason: CrashReason): void {
    if (gone || failure !== undefined) return;
    if (!stopping) failure = reason;
    child.kill('SIGKILL');
  }

  child.on('exit', (code, signal) => {
    if (failure !== undefined) finish({ kind: 'crashed', reason: failure });
    else if (stopping) finish({ kind: 'expected' });
    else finish({ kind: 'crashed', reason: { kind: 'exit', code, signal } });
  });
  child.on('error', (error) => {
    if (child.pid !== undefined) {
      fail({ kind: 'protocol', problem: error.message });
      return;
    }
    failure ??= { kind: 'spawn-error', message: error.message };
    finish({ kind: 'crashed', reason: failure });
  });
  child.on('message', (raw: unknown) => {
    const parsed = PluginMessage.safeParse(raw);
    if (parsed.success) receive(parsed.data);
    else fail({ kind: 'protocol', problem: `sent a malformed message: ${describeIssues(parsed.error).join('; ')}` });
  });

  function receive(message: PluginMessage): void {
    const waiter = pending.get(message.id);
    if (waiter === undefined && abandoned.has(message.id)) {
      if (message.kind === 'stream-end' || message.kind === 'error') abandoned.delete(message.id);
      return;
    }
    if (waiter === undefined) {
      fail({ kind: 'protocol', problem: `answered unknown request ${String(message.id)}` });
      return;
    }
    switch (message.kind) {
      case 'init-result':
        if (waiter.kind !== 'init') break;
        settle(message.id);
        waiter.resolve(message.pluginKind);
        return;
      case 'health-result':
        if (waiter.kind !== 'health') break;
        settle(message.id);
        waiter.resolve(message.health);
        return;
      case 'shutdown-result':
        if (waiter.kind !== 'shutdown') break;
        settle(message.id);
        waiter.resolve();
        return;
      case 'stream-chunk':
        if (waiter.kind !== 'stream') break;
        try {
          waiter.onChunk(message.chunk);
        } catch (error) {
          abandon(message.id);
          waiter.reject(error instanceof Error ? error : new Error(String(error)));
        }
        return;
      case 'stream-end':
        if (waiter.kind !== 'stream') break;
        settle(message.id);
        waiter.resolve(message.finishReason);
        return;
      case 'error':
        settle(message.id);
        waiter.reject(new PluginRequestError(message.code, message.message));
        return;
    }
    fail({ kind: 'protocol', problem: `answered a ${waiter.kind} request with ${message.kind}` });
  }

  function settle(id: number): void {
    clearTimeout(pending.get(id)?.timer);
    pending.delete(id);
  }

  /** Stops waiting for a stream and tells the plugin to cancel it; its late replies are ignored. */
  function abandon(id: number): boolean {
    if (!pending.has(id)) return false;
    settle(id);
    abandoned.add(id);
    send({ kind: 'cancel', id });
    return true;
  }

  function send(message: HostMessage): void {
    child.send(message, (error) => {
      if (error) fail({ kind: 'protocol', problem: `could not reach the plugin: ${error.message}` });
    });
  }

  function request(
    variant: Variant,
    reject: (error: Error) => void,
    timeoutMs: number | undefined,
    message: (id: number) => HostMessage,
  ): number {
    const id = nextId++;
    if (gone) {
      reject(new PluginGoneError());
      return id;
    }
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            fail({ kind: 'timeout', request: variant.kind });
          }, timeoutMs);
    const waiter: Pending = { ...variant, reject, timer };
    pending.set(id, waiter);
    send(message(id));
    return id;
  }

  return {
    pid: child.pid,
    exited: exit.promise,
    init: (config) =>
      new Promise((resolve, reject) => {
        request({ kind: 'init', resolve }, reject, timeouts.initMs, (id) => ({ kind: 'init', id, config }));
      }),
    health: () =>
      new Promise((resolve, reject) => {
        request({ kind: 'health', resolve }, reject, timeouts.healthMs, (id) => ({ kind: 'health', id }));
      }),
    stream: (streamRequest, onChunk, signal) =>
      signal?.aborted ? Promise.resolve('cancelled') : new Promise((resolve, reject) => {
        const onAbort = (): void => {
          if (!abandon(id)) return;
          signal?.removeEventListener('abort', onAbort);
          resolve('cancelled');
        };
        const id = request(
          {
            kind: 'stream',
            onChunk,
            resolve: (reason) => {
              signal?.removeEventListener('abort', onAbort);
              resolve(reason);
            },
          },
          (error) => {
            signal?.removeEventListener('abort', onAbort);
            reject(error);
          },
          undefined,
          (requestId) => ({ kind: 'stream', id: requestId, request: streamRequest }),
        );
        signal?.addEventListener('abort', onAbort, { once: true });
      }),
    stop: async () => {
      if (!stopping && !gone) {
        stopping = true;
        for (const waiter of pending.values()) clearTimeout(waiter.timer);
        killer = setTimeout(() => {
          child.kill('SIGKILL');
        }, timeouts.shutdownMs);
        request({ kind: 'shutdown', resolve: () => undefined }, () => undefined, undefined, (id) => ({
          kind: 'shutdown',
          id,
        }));
      }
      await exit.promise;
      clearTimeout(killer);
    },
  };
}
