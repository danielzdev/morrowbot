import type { z } from 'zod';
import type { JsonRpcProcess, StartJsonRpcProcess } from '../json-rpc-process.ts';
import { refusal } from './permission.ts';
import { InitializeResponse, PermissionRequest, SessionNotification, SessionScoped, type SessionUpdate } from './protocol.ts';
import { createTripwire, type Breach } from './tripwire.ts';

/** Under the host's 30 s provider-info deadline, which starts the agent. */
const INITIALIZE_MS = 25_000;
const CLIENT_INFO = { name: 'morrowbot', title: 'MorrowBot', version: '0.1.0' };
/** MorrowBot offers the agent no file or terminal access of its own: the agent uses its own tools, which ask first. */
const CLIENT_CAPABILITIES = { fs: { readTextFile: false, writeTextFile: false }, terminal: false };

/** The answer to one agent call: a parsed result, the agent's own error, or no usable answer. */
export type Call<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'error'; readonly code: number; readonly message: string }
  | { readonly kind: 'unanswered'; readonly reason: string };

/** What one open session hears from the agent. */
export interface SessionHandlers {
  /** A `session/update` notification's `update`. */
  readonly onUpdate: (update: SessionUpdate) => void;
  /** A `session/request_permission`; resolves to the ACP result. */
  readonly onPermission: (request: PermissionRequest) => Promise<unknown>;
  /** The client refused a request of the agent's own (a file write, a terminal) for this session. */
  readonly onRefused: (method: string) => void;
  /** Whether the agent is replaying the session's saved history. */
  readonly replaying: () => boolean;
}

/** One running ACP agent (`agy acp`, `opencode acp`): a provider's shared daemon. */
export interface AcpClient {
  /** The version the agent reported in `initialize`, or null. */
  readonly version: string | null;
  /** Whether the agent can reopen a saved session (`session/load`) and free one (`session/close`). */
  readonly canLoad: boolean;
  readonly canClose: boolean;
  /** Whether the agent connects to MCP servers over HTTP (`mcpCapabilities.http`). */
  readonly mcpHttp: boolean;
  alive(): boolean;
  call<S extends z.ZodType>(method: string, params: unknown, schema: S, timeoutMs: number): Promise<Call<z.infer<S>>>;
  notify(method: string, params: unknown): void;
  /** Routes one session's updates and requests here until the returned function is called. */
  attach(sessionId: string, handlers: SessionHandlers): () => void;
  /**
   * Marks a session the provider runs with full access: the changes it makes are allowed, so the
   * tripwire stops watching it until the returned function is called (once the session is closed).
   * Every other session stays fenced.
   */
  trust(sessionId: string): () => void;
  /** Hears the agent exit. */
  readonly exited: Promise<void>;
  close(): Promise<void>;
  /** The agent broke the read-only rules: reports why once (`onBreach`), and ends the agent with every session on it. */
  breach(found: Breach): void;
}

export interface AcpClientOptions {
  /** The agent as the user knows it, in messages: "Antigravity", "OpenCode". */
  readonly name: string;
  readonly args: readonly string[];
  /** Where the agent runs: the provider's own data folder. */
  readonly cwd: string;
  /** Variables the agent gets on top of the runtime's environment. */
  readonly env?: Readonly<Record<string, string>>;
  /** The user's home folder, shown as `~` in what a breach names. */
  readonly home: string | null;
  /** Hears, once, that the agent broke the read-only rules, with the version it reported; the agent then ends. */
  readonly onBreach: (breach: Breach, version: string | null) => void;
}

export type AcpStart = { readonly kind: 'started'; readonly client: AcpClient } | { readonly kind: 'failed'; readonly reason: string };

/**
 * Starts an ACP v1 agent as a provider's shared daemon (`jsonRpcProcess`, scope `daemon`) and
 * completes the `initialize` handshake. The client is read-only:
 * - it offers no file or terminal access: the agent's own requests to write a file or run a
 *   terminal are refused, and so is any other request but `session/request_permission`, which goes
 *   to the session's handlers (refused when no session holds it);
 * - every session's updates go through a tripwire, held by a session or not, except a loaded
 *   session's replayed history and a session marked `trust`ed (full access). A change the agent reports finished without asking is a breach:
 *   `onBreach` hears it once and the agent ends, failing every request still waiting on it.
 */
export async function startAcpClient(jsonRpcProcess: StartJsonRpcProcess, command: string, options: AcpClientOptions): Promise<AcpStart> {
  const { name } = options;
  const sessions = new Map<string, SessionHandlers>();
  const trusted = new Set<string>();
  const ending = new AbortController();
  let alive = true;
  let version: string | null = null;
  let breached = false;
  const breach = (found: Breach): void => {
    if (breached) return;
    breached = true;
    options.onBreach(found, version);
    setTimeout(() => {
      ending.abort();
    }, 0);
  };
  const tripwire = createTripwire(options.home, breach);
  const refuse = (method: string, params: unknown, why: string): Promise<never> => {
    const scoped = SessionScoped.safeParse(params);
    if (scoped.success) sessions.get(scoped.data.sessionId)?.onRefused(method);
    return Promise.reject(new Error(why));
  };
  const rpc: JsonRpcProcess = jsonRpcProcess(command, {
    args: options.args,
    cwd: options.cwd,
    files: [],
    ...(options.env === undefined ? {} : { env: options.env }),
    signal: ending.signal,
    onNotification: (method, params) => {
      if (method !== 'session/update') return;
      const notification = SessionNotification.safeParse(params);
      if (!notification.success) return;
      const { sessionId, update } = notification.data;
      const handlers = sessions.get(sessionId);
      if (handlers?.replaying() !== true && !trusted.has(sessionId)) tripwire.hear(sessionId, update);
      handlers?.onUpdate(update);
    },
    onRequest: (method, params) => {
      if (method === 'session/request_permission') {
        const request = PermissionRequest.safeParse(params);
        if (!request.success) return Promise.resolve({ outcome: { outcome: 'cancelled' } });
        const handlers = sessions.get(request.data.sessionId);
        return handlers === undefined ? Promise.resolve(refusal(request.data.options)) : handlers.onPermission(request.data);
      }
      if (method === 'fs/write_text_file') return refuse(method, params, `MorrowBot runs ${name} read-only: it writes no files.`);
      if (method.startsWith('terminal/')) return refuse(method, params, `MorrowBot runs ${name} read-only: it runs no commands.`);
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
        return { kind: 'unanswered', reason: `${name} did not answer ${method} within ${String(Math.round(timeoutMs / 1000))} s` };
      case 'exited':
        return { kind: 'unanswered', reason: `${name} exited before it answered ${method}` };
      case 'error':
        return { kind: 'error', code: reply.code, message: reply.message };
      case 'result': {
        const parsed = schema.safeParse(reply.value);
        return parsed.success
          ? { kind: 'ok', value: parsed.data }
          : { kind: 'unanswered', reason: `${name} answered ${method} in a shape MorrowBot does not know: ${parsed.error.message}` };
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
    if (exit.kind === 'not-found') return { kind: 'failed', reason: `${name} CLI not found ("${command}")` };
    if (hello.kind === 'ok') return { kind: 'failed', reason: `${name} speaks ACP version ${String(hello.value.protocolVersion)}; MorrowBot speaks version 1.` };
    return { kind: 'failed', reason: hello.kind === 'error' ? `${name} refused to start: ${hello.message}` : hello.reason };
  }
  const capabilities = hello.value.agentCapabilities;
  version = hello.value.agentInfo?.version ?? null;
  return {
    kind: 'started',
    client: {
      version,
      canLoad: capabilities?.loadSession === true,
      canClose: capabilities?.sessionCapabilities?.close !== undefined,
      mcpHttp: capabilities?.mcpCapabilities?.http === true,
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
      trust: (sessionId) => {
        trusted.add(sessionId);
        return () => {
          trusted.delete(sessionId);
        };
      },
      exited,
      close,
      breach,
    },
  };
}
