import type { JsonRpcProcess, StartJsonRpcProcess, z } from '@morrowbot/plugin-sdk';
import { InitializeResponse, ThreadStatusChanged, ThreadScoped, TokenUsageUpdated, type TokenUsageBreakdown } from './protocol.ts';

/**
 * `thread/unsubscribe` unloads a thread at once only with no unload delay (checked on 0.171: with
 * the default delay the thread stays in `thread/loaded/list`). A cold load relies on it.
 */
const LAUNCH_ARGS = ['app-server', '-c', 'thread_unload_delay_secs=0'] as const;
const INITIALIZE_MS = 30_000;
const CLIENT_INFO = { name: 'morrowbot', title: 'MorrowBot', version: '0.1.0' } as const;

/** The answer to one daemon call: a parsed result, the daemon's own error, or no usable answer. */
export type Call<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'error'; readonly code: number; readonly message: string }
  | { readonly kind: 'unanswered'; readonly reason: string };

export type DaemonEvent =
  | { readonly kind: 'notification'; readonly method: string; readonly params: unknown }
  /** The daemon asked for an approval and was refused without asking anyone. */
  | { readonly kind: 'declined'; readonly method: string; readonly params: unknown }
  | { readonly kind: 'exited' };

/** What a thread was loaded with in this daemon; a running thread ignores new overrides. */
export interface LoadedThread {
  readonly routeKey: string;
  readonly policyKey: string;
  readonly model: string | null;
}

export interface CodexDaemon {
  /** Counts the daemons this plugin process started: a thread loaded in one is not loaded in the next. */
  readonly generation: number;
  /** `$CODEX_HOME` as the daemon resolved it. */
  readonly codexHome: string | null;
  alive(): boolean;
  call<S extends z.ZodType>(method: string, params: unknown, schema: S, timeoutMs: number): Promise<Call<z.infer<S>>>;
  /** Hears every event until the returned function is called. */
  listen(listener: (event: DaemonEvent) => void): () => void;
  /** The newest cumulative token total this daemon reported for a thread. */
  lastTotal(threadId: string): TokenUsageBreakdown | undefined;
  readonly loaded: Map<string, LoadedThread>;
  readonly exited: Promise<void>;
  close(): Promise<void>;
}

export type DaemonStart = { readonly kind: 'started'; readonly daemon: CodexDaemon } | { readonly kind: 'failed'; readonly reason: string };

/**
 * Approval requests MorrowBot answers. v1 Codex turns are read-only with approval policy `never`,
 * so a request here is unexpected; it is declined without a card.
 */
const DECLINES: Readonly<Record<string, unknown>> = {
  'item/commandExecution/requestApproval': { decision: 'decline' },
  'item/fileChange/requestApproval': { decision: 'decline' },
  execCommandApproval: { decision: { denied: { rejection: 'MorrowBot turns do not approve this.' } } },
  applyPatchApproval: { decision: { denied: { rejection: 'MorrowBot turns do not approve this.' } } },
};

/** Starts `codex app-server` as this plugin's shared daemon and completes the `initialize` handshake. */
export async function startDaemon(jsonRpcProcess: StartJsonRpcProcess, cliPath: string, cwd: string, generation: number): Promise<DaemonStart> {
  const listeners = new Set<(event: DaemonEvent) => void>();
  const totals = new Map<string, TokenUsageBreakdown>();
  const loaded = new Map<string, LoadedThread>();
  let alive = true;
  const tell = (event: DaemonEvent): void => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error(`provider-openai: a daemon listener threw on ${event.kind}`, error);
      }
    }
  };
  const rpc: JsonRpcProcess = jsonRpcProcess(cliPath, {
    args: LAUNCH_ARGS,
    cwd,
    files: [],
    signal: new AbortController().signal,
    onNotification: (method, params) => {
      if (method === 'thread/tokenUsage/updated') {
        const update = TokenUsageUpdated.safeParse(params);
        if (update.success) totals.set(update.data.threadId, update.data.tokenUsage.total);
      }
      if (method === 'thread/closed') {
        const closed = ThreadScoped.safeParse(params);
        if (closed.success) loaded.delete(closed.data.threadId);
      }
      if (method === 'thread/status/changed') {
        const changed = ThreadStatusChanged.safeParse(params);
        if (changed.success && changed.data.status.type === 'notLoaded') loaded.delete(changed.data.threadId);
      }
      tell({ kind: 'notification', method, params });
    },
    onRequest: (method, params) => {
      const decline = DECLINES[method];
      if (decline === undefined) return Promise.reject(new Error(`MorrowBot does not answer ${method}`));
      tell({ kind: 'declined', method, params });
      return Promise.resolve(decline);
    },
  });
  const exited = rpc.exited.then(() => {
    alive = false;
    tell({ kind: 'exited' });
  });
  const call = async <S extends z.ZodType>(method: string, params: unknown, schema: S, timeoutMs: number): Promise<Call<z.infer<S>>> => {
    const reply = await rpc.request(method, params, { timeoutMs });
    switch (reply.kind) {
      case 'timeout':
        return { kind: 'unanswered', reason: `Codex did not answer ${method} within ${String(Math.round(timeoutMs / 1000))} s` };
      case 'exited':
        return { kind: 'unanswered', reason: `Codex exited before it answered ${method}` };
      case 'error':
        return { kind: 'error', code: reply.code, message: reply.message };
      case 'result': {
        const parsed = schema.safeParse(reply.value);
        return parsed.success
          ? { kind: 'ok', value: parsed.data }
          : { kind: 'unanswered', reason: `Codex answered ${method} in a shape MorrowBot does not know: ${parsed.error.message}` };
      }
    }
  };
  const daemon: CodexDaemon = {
    generation,
    codexHome: null,
    alive: () => alive,
    call,
    listen: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    lastTotal: (threadId) => totals.get(threadId),
    loaded,
    exited,
    close: async () => {
      await rpc.close();
      await exited;
    },
  };
  const hello = await call(
    'initialize',
    { clientInfo: CLIENT_INFO, capabilities: { experimentalApi: true, requestAttestation: false } },
    InitializeResponse,
    INITIALIZE_MS,
  );
  if (hello.kind !== 'ok') {
    await daemon.close();
    const exit = await rpc.exited;
    if (exit.kind === 'not-found') return { kind: 'failed', reason: `Codex CLI not found ("${cliPath}")` };
    return { kind: 'failed', reason: hello.kind === 'error' ? `Codex refused to start: ${hello.message}` : hello.reason };
  }
  rpc.notify('initialized', undefined);
  return { kind: 'started', daemon: { ...daemon, codexHome: hello.value.codexHome ?? null } };
}
