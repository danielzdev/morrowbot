import { EventServerFrame, lenient, type EventClientFrame } from '@morrowbot/contracts';
import type { LinkStatus } from '../../lib/host-connection.ts';

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
  /** Which socket is open now, or null while none is. Each socket gets a new number. */
  readonly session: () => number | null;
  /** Sends on socket `session`, and only while it is still the open one. */
  readonly send: (session: number, frame: EventClientFrame) => void;
  /** Closes the socket while the app is in the background. */
  readonly pause: () => void;
  /** Connects now: the first time, after a pause, or instead of waiting out the backoff. */
  readonly wake: () => void;
  /** Stops for good, as when the host unpaired this device. */
  readonly revoke: () => void;
  readonly close: () => void;
}

/** The host closes a paired device's sockets with 1008 when the device is unpaired. */
const UNPAIRED = 1008;
const Frame = lenient(EventServerFrame);

type Link =
  | { readonly kind: 'connecting'; readonly socket: Socket }
  | { readonly kind: 'open'; readonly socket: Socket; readonly session: number }
  | { readonly kind: 'waiting'; readonly timer: ReturnType<typeof setTimeout>; readonly attempt: number }
  | { readonly kind: 'paused' }
  | { readonly kind: 'stopped' };

/**
 * One `/api/events` socket to a host. It starts paused until `wake`, reconnects with exponential
 * backoff when it drops, and skips frames it does not know. What to subscribe to is up to the caller.
 */
export function openEventStream(options: EventStreamOptions): EventStream {
  const url = `${options.url.replace(/^http/, 'ws')}/api/events`;
  const listeners = new Set<(frame: EventServerFrame) => void>();
  let link: Link = { kind: 'paused' };

  /** Bumped whenever a socket is replaced or closed, so a late callback from an old one is ignored. */
  let generation = 0;
  const connect = (attempt: number): void => {
    const mine = ++generation;
    let opened = false;
    options.onStatus({ kind: 'connecting', attempt });
    const socket = options.openSocket(url, options.token, {
      onOpen: () => {
        if (mine !== generation) return;
        opened = true;
        link = { kind: 'open', socket, session: mine };
        options.onStatus({ kind: 'online' });
      },
      onMessage: (text) => {
        if (mine === generation) receive(text);
      },
      onClose: (code) => {
        if (mine !== generation) return;
        generation++;
        if (code === UNPAIRED) end({ kind: 'stopped' }, { kind: 'revoked' });
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

  /** Drops the socket or pending retry and settles in `next`. */
  const end = (next: Extract<Link, { kind: 'paused' | 'stopped' }>, status: LinkStatus | null): void => {
    if (link.kind === 'waiting') clearTimeout(link.timer);
    if (link.kind === 'connecting' || link.kind === 'open') {
      generation++;
      link.socket.close();
    }
    link = next;
    if (status !== null) options.onStatus(status);
  };

  const receive = (text: string): void => {
    const parsed = Frame.safeParse(parseJson(text));
    if (!parsed.success) {
      options.report(`Ignored an unknown host event: ${text.slice(0, 120)}`);
      return;
    }
    for (const listener of listeners) listener(parsed.data);
  };

  return {
    listen: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    session: () => (link.kind === 'open' ? link.session : null),
    send: (session, frame) => {
      if (link.kind === 'open' && link.session === session) link.socket.send(JSON.stringify(frame));
    },
    pause: () => {
      if (link.kind !== 'stopped' && link.kind !== 'paused') end({ kind: 'paused' }, { kind: 'paused' });
    },
    wake: () => {
      if (link.kind === 'paused') connect(0);
      else if (link.kind === 'waiting') {
        clearTimeout(link.timer);
        connect(link.attempt);
      }
    },
    revoke: () => {
      if (link.kind !== 'stopped') end({ kind: 'stopped' }, { kind: 'revoked' });
    },
    close: () => {
      end({ kind: 'stopped' }, null);
      listeners.clear();
    },
  };
}

function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}
