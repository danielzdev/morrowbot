import type { JsonRpcProcess, StartJsonRpcProcess, z } from '@morrowbot/plugin-sdk';
import { InitializeResponse, PermissionRequest, SessionNotification, SessionScoped } from './protocol.ts';
import { refusal } from './permission.ts';

const INITIALIZE_MS = 60_000;
const CLIENT_INFO = { name: 'morrowbot', title: 'MorrowBot', version: '0.1.0' } as const;
/** MorrowBot offers agy no file or terminal access of its own: agy uses its own tools, which ask first. */
const CLIENT_CAPABILITIES = { fs: { readTextFile: false, writeTextFile: false }, terminal: false } as const;

/** The answer to one daemon call: a parsed result, the daemon's own error, or no usable answer. */
export type Call<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'error'; readonly code: number; readonly message: string }
  | { readonly kind: 'unanswered'; readonly reason: string };

/** What one open session hears from the daemon. */
export interface SessionHandlers {
  /** A `session/update` notification's `update`. */
  readonly onUpdate: (update: unknown) => void;
  /** A `session/request_permission`; resolves to the ACP result. */
  readonly onPermission: (request: PermissionRequest) => Promise<unknown>;
  /** The daemon refused a request of agy's own (a file write, a terminal) for this session. */
  readonly onRefused: (method: string) => void;
}

export interface AcpDaemon {
  /** Counts the daemons this provider started. */
  readonly generation: number;
  readonly version: string | null;
  /** Whether agy can reopen a saved session (`session/load`) and free one (`session/close`). */
  readonly canLoad: boolean;
  readonly canClose: boolean;
  alive(): boolean;
  call<S extends z.ZodType>(method: string, params: unknown, schema: S, timeoutMs: number): Promise<Call<z.infer<S>>>;
  notify(method: string, params: unknown): void;
  /** Routes one session's updates and requests here until the returned function is called. */
  attach(sessionId: string, handlers: SessionHandlers): () => void;
  /** Hears the daemon exit. */
  readonly exited: Promise<void>;
  close(): Promise<void>;
}

export type DaemonStart = { readonly kind: 'started'; readonly daemon: AcpDaemon } | { readonly kind: 'failed'; readonly reason: string };

/**
 * Starts `agy acp` as this provider's shared daemon and completes the ACP `initialize` handshake.
 * `geminiDir` is MorrowBot's own Antigravity folder, so agy reads none of the user's settings,
 * permission grants, hooks, plugins or MCP servers; the Google sign-in is shared through the keychain.
 */
export async function startDaemon(jsonRpcProcess: StartJsonRpcProcess, cliPath: string, cwd: string, geminiDir: string, generation: number): Promise<DaemonStart> {
  const sessions = new Map<string, SessionHandlers>();
  let alive = true;
  const refuse = (method: string, params: unknown, why: string): Promise<never> => {
    const scoped = SessionScoped.safeParse(params);
    if (scoped.success) sessions.get(scoped.data.sessionId)?.onRefused(method);
    return Promise.reject(new Error(why));
  };
  const rpc: JsonRpcProcess = jsonRpcProcess(cliPath, {
    args: ['acp', '--gemini-dir', geminiDir],
    cwd,
    files: [],
    signal: new AbortController().signal,
    onNotification: (method, params) => {
      if (method !== 'session/update') return;
      const notification = SessionNotification.safeParse(params);
      if (notification.success) sessions.get(notification.data.sessionId)?.onUpdate(notification.data.update);
    },
    onRequest: (method, params) => {
      if (method === 'session/request_permission') {
        const request = PermissionRequest.safeParse(params);
        if (!request.success) return Promise.reject(new Error('MorrowBot could not read this permission request, so it is denied.'));
        const handlers = sessions.get(request.data.sessionId);
        return handlers === undefined ? Promise.resolve(refusal(request.data.options)) : handlers.onPermission(request.data);
      }
      if (method === 'fs/write_text_file') return refuse(method, params, 'MorrowBot runs Antigravity read-only: it writes no files.');
      if (method.startsWith('terminal/')) return refuse(method, params, 'MorrowBot runs Antigravity read-only: it runs no commands.');
      return refuse(method, params, `MorrowBot does not answer ${method}.`);
    },
  });
  const exited = rpc.exited.then(() => {
    alive = false;
  });
  const call = async <S extends z.ZodType>(method: string, params: unknown, schema: S, timeoutMs: number): Promise<Call<z.infer<S>>> => {
    const reply = await rpc.request(method, params, { timeoutMs });
    switch (reply.kind) {
      case 'timeout':
        return { kind: 'unanswered', reason: `Antigravity did not answer ${method} within ${String(Math.round(timeoutMs / 1000))} s` };
      case 'exited':
        return { kind: 'unanswered', reason: `Antigravity exited before it answered ${method}` };
      case 'error':
        return { kind: 'error', code: reply.code, message: reply.message };
      case 'result': {
        const parsed = schema.safeParse(reply.value);
        return parsed.success
          ? { kind: 'ok', value: parsed.data }
          : { kind: 'unanswered', reason: `Antigravity answered ${method} in a shape MorrowBot does not know: ${parsed.error.message}` };
      }
    }
  };
  const close = async (): Promise<void> => {
    await rpc.close();
    await exited;
  };
  const hello = await call('initialize', { protocolVersion: 1, clientCapabilities: CLIENT_CAPABILITIES, clientInfo: CLIENT_INFO }, InitializeResponse, INITIALIZE_MS);
  if (hello.kind !== 'ok' || hello.value.protocolVersion !== 1) {
    await close();
    const exit = await rpc.exited;
    if (exit.kind === 'not-found') return { kind: 'failed', reason: `Antigravity CLI not found ("${cliPath}")` };
    if (hello.kind === 'ok') return { kind: 'failed', reason: `Antigravity speaks ACP version ${String(hello.value.protocolVersion)}; MorrowBot speaks version 1.` };
    return { kind: 'failed', reason: hello.kind === 'error' ? `Antigravity refused to start: ${hello.message}` : hello.reason };
  }
  const capabilities = hello.value.agentCapabilities;
  return {
    kind: 'started',
    daemon: {
      generation,
      version: hello.value.agentInfo?.version ?? null,
      canLoad: capabilities?.loadSession === true,
      canClose: capabilities?.sessionCapabilities?.close !== undefined,
      alive: () => alive,
      call,
      notify: (method, params) => {
        rpc.notify(method, params);
      },
      attach: (sessionId, handlers) => {
        sessions.set(sessionId, handlers);
        return () => {
          if (sessions.get(sessionId) === handlers) sessions.delete(sessionId);
        };
      },
      exited,
      close,
    },
  };
}
