import type { ProviderError, TurnChunk, TurnOutcome } from '@morrowbot/plugin-sdk';
import type { DaemonEvent } from './daemon.ts';
import {
  AgentMessageDelta,
  ErrorNotification,
  ItemEvent,
  ModelRerouted,
  ThreadScoped,
  TokenUsageUpdated,
  TurnCompleted,
  TurnStarted,
  type TurnError,
} from './protocol.ts';
import type { TokenCounter } from './tokens.ts';
import { describeTool, tilde } from './tool-input.ts';

/** How Codex ended the turn, or that the daemon went away first. */
export type Finish =
  | { readonly kind: 'completed' }
  | { readonly kind: 'interrupted' }
  | { readonly kind: 'failed'; readonly error: TurnError | null }
  | { readonly kind: 'exited' };

export interface TurnStream {
  /** Hears every daemon event; only this thread's are used. */
  hear(event: DaemonEvent): void;
  /** Names the vendor turn: events heard before this are replayed now. */
  begin(turnId: string): void;
  /** The turn a `turn/started` named for this thread before `begin`, or null. */
  startedTurn(): string | null;
  readonly finished: Promise<Finish>;
  /** The text of the last agent message, or null. */
  finalText(): string | null;
  /** A model Codex rerouted the turn to, or null. */
  reroutedTo(): string | null;
  /** Watches for the user message a `turn/steer` sent with `clientId`: its `item/started` is the steer's delivery. */
  expectSteer(clientId: string, steerId: string): void;
  /** Stops watching for a steer Codex refused; false once it was delivered. */
  dropSteer(clientId: string): boolean;
}

export interface StreamOptions {
  readonly threadId: string;
  readonly home: string | null;
  readonly access: 'read-only' | 'full';
  readonly emit: (chunk: TurnChunk) => void;
  readonly tokens: TokenCounter;
  /** Hears an `account/rateLimits/updated` notification: a hint to read the plan usage again. */
  readonly onRateLimitHint: () => void;
  /** Hears the first `turn/started` for this thread before the turn is named. */
  readonly onAnnounced: (turnId: string) => void;
}

/** Turns one vendor turn's notifications into turn chunks, its final text and how it ended. */
export function createTurnStream(options: StreamOptions): TurnStream {
  const { threadId, emit } = options;
  const finished = Promise.withResolvers<Finish>();
  const early: DaemonEvent[] = [];
  const tools = new Set<string>();
  const steers = new Map<string, string>();
  let turnId: string | null = null;
  let announced: string | null = null;
  let lastMessage: string | null = null;
  let rerouted: string | null = null;
  let done = false;

  const finish = (result: Finish): void => {
    if (done) return;
    done = true;
    finished.resolve(result);
  };

  const ours = (params: unknown): boolean => {
    const scoped = ThreadScoped.safeParse(params);
    return scoped.success && scoped.data.threadId === threadId;
  };

  const relevant = (event: DaemonEvent): boolean => {
    switch (event.kind) {
      case 'exited':
        return true;
      case 'declined':
        return ours(event.params);
      case 'notification':
        return event.method === 'account/rateLimits/updated' || ours(event.params);
    }
  };

  const handle = (event: DaemonEvent): void => {
    switch (event.kind) {
      case 'exited':
        finish({ kind: 'exited' });
        return;
      case 'declined':
        if (ours(event.params)) {
          emit({
            kind: 'status',
            text: options.access === 'full' ? 'Denied an unexpected Codex approval request.' : 'Denied a Codex approval request: Ori Kami turns are read-only.',
          });
        }
        return;
      case 'notification':
        notification(event.method, event.params);
        return;
    }
  };

  const notification = (method: string, params: unknown): void => {
    switch (method) {
      case 'account/rateLimits/updated':
        options.onRateLimitHint();
        return;
      case 'thread/tokenUsage/updated': {
        const update = TokenUsageUpdated.safeParse(params);
        if (update.success && update.data.threadId === threadId) options.tokens.observe(update.data);
        return;
      }
      case 'turn/completed': {
        const completed = TurnCompleted.safeParse(params);
        if (!completed.success || completed.data.threadId !== threadId || completed.data.turn.id !== turnId) return;
        const { status, error } = completed.data.turn;
        finish(status === 'completed' ? { kind: 'completed' } : status === 'interrupted' ? { kind: 'interrupted' } : { kind: 'failed', error: error ?? null });
        return;
      }
      case 'item/agentMessage/delta': {
        const delta = AgentMessageDelta.safeParse(params);
        if (delta.success && delta.data.threadId === threadId && delta.data.turnId === turnId && delta.data.delta !== '') {
          emit({ kind: 'text', text: delta.data.delta });
        }
        return;
      }
      case 'item/started':
      case 'item/completed':
        item(method, params);
        return;
      case 'error': {
        const error = ErrorNotification.safeParse(params);
        if (error.success && error.data.threadId === threadId && error.data.turnId === turnId && error.data.willRetry) {
          emit({ kind: 'status', text: `Retrying: ${short(tilde(error.data.error.message, options.home))}` });
        }
        return;
      }
      case 'model/rerouted': {
        const moved = ModelRerouted.safeParse(params);
        if (moved.success && moved.data.threadId === threadId && moved.data.turnId === turnId) {
          rerouted = moved.data.toModel;
          emit({ kind: 'status', text: `Codex switched this reply to ${moved.data.toModel}` });
        }
        return;
      }
      default:
        return;
    }
  };

  const item = (method: 'item/started' | 'item/completed', params: unknown): void => {
    const parsed = ItemEvent.safeParse(params);
    if (!parsed.success || parsed.data.threadId !== threadId || parsed.data.turnId !== turnId) return;
    const { item: entry } = parsed.data;
    if (entry.type === 'userMessage') {
      const steerId = entry.clientId == null ? undefined : steers.get(entry.clientId);
      if (method === 'item/started' && entry.clientId != null && steerId !== undefined) {
        steers.delete(entry.clientId);
        emit({ kind: 'steer-delivered', steerId });
      }
      return;
    }
    if (entry.type === 'reasoning') {
      if (method === 'item/started') emit({ kind: 'status', text: 'Thinking' });
      return;
    }
    if (entry.type === 'agentMessage') {
      if (method === 'item/completed' && entry.text) lastMessage = entry.text;
      return;
    }
    const tool = describeTool(entry, options.home);
    if (tool === null) return;
    if (method === 'item/started' && !tools.has(entry.id)) {
      tools.add(entry.id);
      emit({ kind: 'tool-start', toolUseId: entry.id, name: tool.name, input: tool.input });
    } else if (method === 'item/completed' && tools.delete(entry.id)) {
      emit({ kind: 'tool-end', toolUseId: entry.id, outcome: entry.status === 'failed' || entry.status === 'declined' ? 'error' : 'ok' });
    }
  };

  return {
    hear: (event) => {
      if (done) return;
      if (turnId === null && event.kind === 'notification' && event.method === 'turn/started') {
        const started = TurnStarted.safeParse(event.params);
        if (started.success && started.data.threadId === threadId && announced === null) {
          announced = started.data.turn.id;
          options.onAnnounced(announced);
        }
      }
      if (turnId !== null || event.kind === 'exited') handle(event);
      else if (relevant(event)) early.push(event);
    },
    begin: (id) => {
      turnId = id;
      for (const event of early.splice(0)) {
        if (done) break;
        handle(event);
      }
    },
    startedTurn: () => announced,
    finished: finished.promise,
    finalText: () => lastMessage,
    reroutedTo: () => rerouted,
    expectSteer: (clientId, steerId) => {
      steers.set(clientId, steerId);
    },
    dropSteer: (clientId) => steers.delete(clientId),
  };
}

/** The turn outcome for how Codex ended it. `cancelled` only when the host asked to stop. */
export function outcomeOf(finish: Finish, cancelled: boolean): TurnOutcome {
  switch (finish.kind) {
    case 'completed':
      return { kind: 'completed', finishReason: 'stop' };
    case 'interrupted':
      return cancelled ? { kind: 'cancelled' } : { kind: 'interrupted' };
    case 'exited':
      return { kind: 'interrupted' };
    case 'failed':
      return { kind: 'failed', error: providerError(finish.error) };
  }
}

/** Maps Codex's `codexErrorInfo` onto the contract's errors. */
export function providerError(error: TurnError | null): ProviderError {
  const message = error?.message ?? 'Codex ended the turn with an error';
  const info = error?.codexErrorInfo;
  const code = typeof info === 'string' ? info : info !== null && typeof info === 'object' ? (Object.keys(info)[0] ?? '') : '';
  switch (code) {
    case 'usageLimitExceeded':
    case 'rateLimitExceeded':
      return { kind: 'rate-limited', resetsAt: null, windowId: null };
    case 'contextWindowExceeded':
      return { kind: 'context-too-long' };
    case 'unauthorized':
      return { kind: 'signed-out' };
    case 'modelNotFound':
      return { kind: 'invalid-model' };
    case 'serverOverloaded':
    case 'internalServerError':
    case 'httpConnectionFailed':
    case 'responseStreamConnectionFailed':
    case 'responseStreamDisconnected':
    case 'responseTooManyFailedAttempts':
      return { kind: 'transient', retryAfterMs: null };
    default:
      return { kind: 'other', message };
  }
}

function short(text: string): string {
  return text.length <= 200 ? text : `${text.slice(0, 199)}…`;
}
