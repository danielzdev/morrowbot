import { EventServerFrame, lenient, type Cursor, type EntityId, type EventClientFrame } from '@morrowbot/contracts';
import type { LinkStatus, ThreadWatch } from '../../lib/host-connection.ts';

export interface SocketHandlers {
  readonly onOpen: () => void;
  readonly onMessage: (text: string) => void;
  /** Also called when the socket never opened. */
  readonly onClose: (code: number) => void;
}

export interface Socket {
  readonly send: (text: string) => void;
  readonly close: () => void;
}

/** Opens a WebSocket that sends `authorization: Bearer <token>` with its upgrade request. */
export type OpenSocket = (url: string, token: string, handlers: SocketHandlers) => Socket;

export interface EventStreamOptions {
  /** The host's origin, such as `http://100.64.0.1:47800`. */
  readonly url: string;
  readonly token: string;
  readonly openSocket: OpenSocket;
  /** How long to wait before reconnect attempt `attempt` (1 = the first retry). */
  readonly delayFor: (attempt: number) => number;
  readonly now: () => number;
  readonly onStatus: (status: LinkStatus) => void;
  readonly report: (problem: string) => void;
}

export interface EventStream {
  readonly listen: (listener: (frame: EventServerFrame) => void) => () => void;
  readonly watchThread: (threadId: EntityId, since: Cursor | null) => ThreadWatch;
  readonly retryNow: () => void;
  /** Stops for good, as when the host unpaired this device. */
  readonly revoke: () => void;
  readonly close: () => void;
}

/** The host closes a paired device's sockets with 1008 when the device is unpaired. */
const UNPAIRED = 1008;
const Frame = lenient(EventServerFrame);

/**
 * Where a watched thread is: `live` resumes from `cursor` on every reconnect; `resyncing` waits
 * for the watcher to refetch the thread's state and `resume`.
 */
type Watched = { readonly kind: 'live'; readonly cursor: Cursor | null; readonly watchers: number } | { readonly kind: 'resyncing'; readonly watchers: number };

type Link =
  | { readonly kind: 'connecting'; readonly socket: Socket }
  | { readonly kind: 'open'; readonly socket: Socket }
  | { readonly kind: 'waiting'; readonly timer: ReturnType<typeof setTimeout>; readonly attempt: number }
  | { readonly kind: 'stopped' };

/**
 * One `/api/events` socket to a host that reconnects with exponential backoff and, on every
 * reconnect, resubscribes each watched thread from the last cursor it saw, so nothing is missed.
 * It sends only `subscribe` and `unsubscribe` frames and skips frames it does not know.
 */
export function openEventStream(options: EventStreamOptions): EventStream {
  const url = `${options.url.replace(/^http/, 'ws')}/api/events`;
  const listeners = new Set<(frame: EventServerFrame) => void>();
  const watched = new Map<EntityId, Watched>();
  let link: Link = { kind: 'stopped' };

  const send = (frame: EventClientFrame): void => {
    if (link.kind === 'open') link.socket.send(JSON.stringify(frame));
  };
  const subscribe = (threadId: EntityId): void => {
    const entry = watched.get(threadId);
    if (entry?.kind === 'live') send({ kind: 'subscribe', threadId, since: entry.cursor });
  };

  /** Bumped whenever a socket is replaced or stopped, so a late callback from an old one is ignored. */
  let generation = 0;
  const connect = (attempt: number): void => {
    const mine = ++generation;
    let opened = false;
    options.onStatus({ kind: 'connecting', attempt });
    const socket = options.openSocket(url, options.token, {
      onOpen: () => {
        if (mine !== generation) return;
        opened = true;
        link = { kind: 'open', socket };
        options.onStatus({ kind: 'online' });
        for (const threadId of watched.keys()) subscribe(threadId);
      },
      onMessage: (text) => {
        if (mine === generation) receive(text);
      },
      onClose: (code) => {
        if (mine !== generation) return;
        generation++;
        if (code === UNPAIRED) stop({ kind: 'revoked' });
        else wait(opened ? 1 : attempt + 1);
      },
    });
    if (mine === generation && link.kind !== 'open') link = { kind: 'connecting', socket };
  };

  const wait = (attempt: number): void => {
    const delay = options.delayFor(attempt);
    link = {
      kind: 'waiting',
      attempt,
      timer: setTimeout(() => {
        connect(attempt);
      }, delay),
    };
    options.onStatus({ kind: 'reconnecting', attempt, retryAt: options.now() + delay });
  };

  const stop = (status: LinkStatus | null): void => {
    if (link.kind === 'waiting') clearTimeout(link.timer);
    if (link.kind === 'connecting' || link.kind === 'open') {
      generation++;
      link.socket.close();
    }
    link = { kind: 'stopped' };
    if (status !== null) options.onStatus(status);
  };

  const receive = (text: string): void => {
    const parsed = Frame.safeParse(parseJson(text));
    if (!parsed.success) {
      options.report(`Ignored an unknown host event: ${text.slice(0, 120)}`);
      return;
    }
    const frame = parsed.data;
    if (!track(watched, frame)) return;
    for (const listener of listeners) listener(frame);
  };

  connect(0);

  return {
    listen: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    watchThread: (threadId, since) => {
      const existing = watched.get(threadId);
      watched.set(threadId, { kind: 'live', cursor: since, watchers: (existing?.watchers ?? 0) + 1 });
      subscribe(threadId);
      let closed = false;
      return {
        resume: (cursor) => {
          const entry = watched.get(threadId);
          if (closed || entry === undefined) return;
          watched.set(threadId, { kind: 'live', cursor, watchers: entry.watchers });
          subscribe(threadId);
        },
        close: () => {
          const entry = watched.get(threadId);
          if (closed || entry === undefined) return;
          closed = true;
          if (entry.watchers > 1) {
            watched.set(threadId, { ...entry, watchers: entry.watchers - 1 });
            return;
          }
          watched.delete(threadId);
          send({ kind: 'unsubscribe', threadId });
        },
      };
    },
    retryNow: () => {
      if (link.kind !== 'waiting') return;
      clearTimeout(link.timer);
      connect(link.attempt);
    },
    revoke: () => {
      if (link.kind !== 'stopped') stop({ kind: 'revoked' });
    },
    close: () => {
      stop(null);
      listeners.clear();
    },
  };
}

/**
 * Moves a watched thread's cursor past `frame`. False for an event already seen (same host
 * epoch, an earlier or equal `seq`), which must not be delivered twice.
 */
function track(watched: Map<EntityId, Watched>, frame: EventServerFrame): boolean {
  switch (frame.kind) {
    case 'usage.updated':
    case 'agent-message.posted':
      return true;
    case 'resync': {
      const entry = watched.get(frame.threadId);
      if (entry !== undefined) watched.set(frame.threadId, { kind: 'resyncing', watchers: entry.watchers });
      return true;
    }
    case 'generation.started':
    case 'generation.status':
    case 'generation.delta':
    case 'generation.tool-start':
    case 'generation.tool-end':
    case 'generation.approval-requested':
    case 'generation.approval-resolved':
    case 'generation.steered':
    case 'generation.finished':
    case 'generation.background-started':
    case 'generation.background-finished':
    case 'queue.changed': {
      const entry = watched.get(frame.threadId);
      if (entry?.kind !== 'live') return true;
      const seen = entry.cursor;
      if (seen !== null && seen.hostEpoch === frame.cursor.hostEpoch && frame.cursor.seq <= seen.seq) return false;
      watched.set(frame.threadId, { ...entry, cursor: frame.cursor });
      return true;
    }
  }
}

function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}
