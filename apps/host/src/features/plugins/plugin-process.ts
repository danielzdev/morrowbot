import {
  PluginMessage,
  PROTOCOL_VERSION,
  type CrashReason,
  type HostMessage,
  type OpenPluginChannel,
  type PluginConfig,
  type PluginHealth,
  type PluginKind,
  type PluginToolDefinition,
  type PluginToolResult,
  type ProviderInfo,
  type RouteInfo,
  type TurnChunk,
  type TurnEnd,
  type TurnRequest,
  type UsageResult,
} from '@morrowbot/contracts';
import { describeIssues } from './issues.ts';
import {
  PluginCancelledError,
  PluginGoneError,
  PluginRequestError,
  PluginTimeoutError,
  type PluginExit,
  type PluginTimeouts,
} from './plugin-errors.ts';

export { PluginCancelledError, PluginGoneError, PluginRequestError, PluginTimeoutError } from './plugin-errors.ts';
export type { PluginExit, PluginTimeouts } from './plugin-errors.ts';

export interface TurnHandlers {
  onChunk(chunk: TurnChunk): void;
  onEnd(end: TurnEnd): void;
}

export interface ChildGroupListener {
  started(message: Extract<PluginMessage, { kind: 'child-group-started' }>): void;
  exited(pgid: number): void;
}

/** One running plugin as the host drives it: a worker process, or a built-in provider in this process. */
export interface PluginProcess {
  /** Settles once, when the process is gone. */
  readonly exited: Promise<PluginExit>;
  init(config: PluginConfig, dataDir: string): Promise<PluginKind>;
  health(): Promise<PluginHealth>;
  providerInfo(refresh: boolean): Promise<ProviderInfo>;
  usage(refresh: boolean): Promise<UsageResult>;
  routeInfo(cwd: string): Promise<RouteInfo>;
  listTools(): Promise<readonly PluginToolDefinition[]>;
  callTool(turnId: string, name: string, input: unknown, signal: AbortSignal): Promise<PluginToolResult>;
  /** Sends a turn. Its chunks and `turn-end` are routed by `turnId`, never through the request map. */
  startTurn(request: TurnRequest, handlers: TurnHandlers): void;
  cancelTurn(turnId: string): void;
  steerTurn(turnId: string, steerId: string, text: string): void;
  replyApproval(turnId: string, approvalId: string, choiceId: string): void;
  /** Stops routing a turn's messages; true if it had not ended. */
  forgetTurn(turnId: string): boolean;
  /** Whether a turn has been sent and has not ended. */
  hasTurn(turnId: string): boolean;
  ackChildGroup(pgid: number): void;
  /** Asks the plugin to have the guard of `pgid` stop its group (SIGTERM, then SIGKILL a second later). */
  killChildGroup(pgid: number): void;
  /** Kills the process through its own handle (SIGKILL). Its guards sweep their groups on pipe EOF. */
  kill(): void;
  /** Asks the plugin to shut down, then kills it if it has not exited within the shutdown timeout. */
  stop(): Promise<void>;
}

interface Waiter {
  readonly name: string;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout | undefined;
  readonly cleanup: (() => void) | undefined;
  readonly accept: (message: PluginMessage) => boolean;
}

export interface ConnectOptions {
  readonly timeouts: PluginTimeouts;
  readonly groups: ChildGroupListener;
  readonly log: (message: string) => void;
}

/** Starts a plugin through `open` and talks to it over that channel (wire protocol v1). */
export function connectPlugin(open: OpenPluginChannel, { timeouts, groups, log }: ConnectOptions): PluginProcess {
  const pending = new Map<number, Waiter>();
  const turns = new Map<string, TurnHandlers>();
  const exit = Promise.withResolvers<PluginExit>();
  let nextId = 0;
  let infoCount = 0;
  let stopping = false;
  let failure: CrashReason | undefined;
  let gone = false;
  let killer: NodeJS.Timeout | undefined;
  const child = open({
    exit: (code, signal) => {
      if (failure !== undefined) finish({ kind: 'crashed', reason: failure });
      else if (stopping) finish({ kind: 'expected' });
      else finish({ kind: 'crashed', reason: { kind: 'exit', code, signal } });
    },
    error: (error, started) => {
      if (started) {
        fail({ kind: 'protocol', problem: error.message });
        return;
      }
      failure ??= { kind: 'spawn-error', message: error.message };
      finish({ kind: 'crashed', reason: failure });
    },
    message: (raw) => {
      const parsed = PluginMessage.safeParse(raw);
      if (parsed.success) receive(parsed.data);
      else fail({ kind: 'protocol', problem: `sent a malformed message: ${describeIssues(parsed.error).join('; ')}` });
    },
  });

  function finish(result: PluginExit): void {
    if (gone) return;
    gone = true;
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.cleanup?.();
      waiter.reject(new PluginGoneError());
    }
    pending.clear();
    exit.resolve(result);
  }

  function fail(reason: CrashReason): void {
    if (gone || failure !== undefined) return;
    if (!stopping) failure = reason;
    child.kill();
  }

  function receive(message: PluginMessage): void {
    switch (message.kind) {
      case 'turn-chunk': {
        const handlers = turns.get(message.turnId);
        if (handlers === undefined) log(`dropped output for unknown turn ${message.turnId}`);
        else
          guarded(() => {
            handlers.onChunk(message.chunk);
          });
        return;
      }
      case 'turn-end': {
        const handlers = turns.get(message.turnId);
        turns.delete(message.turnId);
        const { outcome, usage, actualModel, accountKey, sessionTouched, finalText } = message;
        if (handlers === undefined) log(`dropped the end of unknown turn ${message.turnId}`);
        else
          guarded(() => {
            handlers.onEnd({ outcome, usage, actualModel, accountKey, sessionTouched, finalText });
          });
        return;
      }
      case 'child-group-started':
        guarded(() => {
          groups.started(message);
        });
        return;
      case 'child-group-exited':
        guarded(() => {
          groups.exited(message.pgid);
        });
        return;
      case 'init-result':
      case 'health-result':
      case 'shutdown-result':
      case 'provider-info-result':
      case 'usage-result':
      case 'route-info-result':
      case 'route-info-failed':
      case 'tools-list-result':
      case 'tool-call-result':
      case 'error':
        answer(message);
        return;
    }
  }

  function answer(message: Extract<PluginMessage, { id: number }>): void {
    const waiter = pending.get(message.id);
    if (waiter === undefined) {
      log(`ignored a late or unknown ${message.kind} for request ${String(message.id)}`);
      return;
    }
    clearTimeout(waiter.timer);
    waiter.cleanup?.();
    pending.delete(message.id);
    if (message.kind === 'error') {
      waiter.reject(new PluginRequestError(message.code, message.message));
    } else if (!waiter.accept(message)) {
      fail({ kind: 'protocol', problem: `answered a ${waiter.name} request with ${message.kind}` });
    }
  }

  function guarded(work: () => void): void {
    try {
      work();
    } catch (error) {
      log(`a plugin message handler threw: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function send(message: HostMessage): void {
    if (gone || !child.connected) return;
    child.send(message, (error) => {
      if (error) fail({ kind: 'protocol', problem: `could not reach the plugin: ${error.message}` });
    });
  }

  /**
   * Sends one request and settles with its answer. A timeout fails this request only,
   * except for `init`, whose timeout ends the process (the slot then reports the crash).
   */
  function request<T>(
    name: string,
    timeoutMs: number | undefined,
    message: (id: number) => HostMessage,
    read: (message: PluginMessage) => T | undefined,
    cancel?: { readonly signal: AbortSignal; readonly onCancel: (id: number) => void },
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = nextId++;
      if (gone) {
        reject(new PluginGoneError());
        return;
      }
      if (cancel?.signal.aborted === true) {
        reject(new PluginCancelledError());
        return;
      }
      let cleanup: (() => void) | undefined;
      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              pending.delete(id);
              cleanup?.();
              cancel?.onCancel(id);
              if (name === 'init') fail({ kind: 'timeout', request: name });
              reject(new PluginTimeoutError(name));
            }, timeoutMs);
      if (cancel !== undefined) {
        const onAbort = (): void => {
          if (!pending.delete(id)) return;
          clearTimeout(timer);
          cancel.onCancel(id);
          reject(new PluginCancelledError());
        };
        cancel.signal.addEventListener('abort', onAbort, { once: true });
        cleanup = () => {
          cancel.signal.removeEventListener('abort', onAbort);
        };
      }
      pending.set(id, {
        name,
        reject,
        timer,
        cleanup,
        accept: (reply) => {
          const value = read(reply);
          if (value === undefined) return false;
          resolve(value);
          return true;
        },
      });
      send(message(id));
    });
  }

  return {
    exited: exit.promise,
    init: (config, dataDir) =>
      request(
        'init',
        timeouts.initMs,
        (id) => ({ kind: 'init', id, protocolVersion: PROTOCOL_VERSION, config, dataDir }),
        (reply) => (reply.kind === 'init-result' ? reply.pluginKind : undefined),
      ),
    health: () =>
      request(
        'health',
        timeouts.healthMs,
        (id) => ({ kind: 'health', id }),
        (reply) => (reply.kind === 'health-result' ? reply.health : undefined),
      ),
    providerInfo: (refresh) =>
      request(
        'provider-info',
        infoCount++ === 0 ? timeouts.firstInfoMs : timeouts.infoMs,
        (id) => ({ kind: 'provider-info', id, refresh }),
        (reply) => (reply.kind === 'provider-info-result' ? reply.info : undefined),
      ),
    usage: (refresh) =>
      request(
        'usage',
        timeouts.usageMs,
        (id) => ({ kind: 'usage', id, refresh }),
        (reply) => (reply.kind === 'usage-result' ? reply.usage : undefined),
      ),
    routeInfo: (cwd) =>
      request<RouteInfo>(
        'route-info',
        timeouts.routeInfoMs,
        (id) => ({ kind: 'route-info', id, cwd }),
        (reply) => {
          if (reply.kind === 'route-info-result') return { kind: 'known', accountKey: reply.accountKey, routeKey: reply.routeKey };
          if (reply.kind === 'route-info-failed') return { kind: 'failed', reason: reply.reason };
          return undefined;
        },
      ),
    listTools: () =>
      request(
        'tools-list',
        timeouts.toolsListMs,
        (id) => ({ kind: 'tools-list', id }),
        (reply) => (reply.kind === 'tools-list-result' ? reply.tools : undefined),
      ),
    callTool: (turnId, name, input, signal) =>
      request(
        'tool-call',
        timeouts.toolCallMs,
        (id) => ({ kind: 'tool-call', id, turnId, name, input }),
        (reply) => (reply.kind === 'tool-call-result' ? reply.result : undefined),
        {
          signal,
          onCancel: (callId) => {
            send({ kind: 'tool-cancel', callId });
          },
        },
      ),
    startTurn: (turn, handlers) => {
      turns.set(turn.turnId, handlers);
      send({ kind: 'turn', ...turn });
    },
    cancelTurn: (turnId) => {
      if (turns.has(turnId)) send({ kind: 'cancel', turnId });
    },
    steerTurn: (turnId, steerId, text) => {
      if (turns.has(turnId)) send({ kind: 'steer', turnId, steerId, text });
    },
    replyApproval: (turnId, approvalId, choiceId) => {
      if (turns.has(turnId)) send({ kind: 'approval-reply', turnId, approvalId, choiceId });
    },
    forgetTurn: (turnId) => turns.delete(turnId),
    hasTurn: (turnId) => turns.has(turnId),
    ackChildGroup: (pgid) => {
      send({ kind: 'child-group-ack', pgid });
    },
    killChildGroup: (pgid) => {
      send({ kind: 'kill-child-group', pgid });
    },
    kill: () => {
      if (!gone) child.kill();
    },
    stop: async () => {
      if (!stopping && !gone) {
        stopping = true;
        for (const waiter of pending.values()) clearTimeout(waiter.timer);
        killer = setTimeout(() => {
          child.kill();
        }, timeouts.shutdownMs);
        request('shutdown', undefined, (id) => ({ kind: 'shutdown', id }), (reply) =>
          reply.kind === 'shutdown-result' ? true : undefined,
        ).catch(() => undefined);
      }
      await exit.promise;
      clearTimeout(killer);
    },
  };
}
