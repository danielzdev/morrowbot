import type { ApiError, Cursor, EntityId, EventServerFrame, ThreadState } from '@morrowbot/contracts';
import { createContext, useContext } from 'react';
import type { z } from 'zod';
import type { PairingTarget } from './pairing-link.ts';

/**
 * The contract between the host connection (`features/connection`) and every screen that talks
 * to the host. Screens read it with `useHostConnection()`; only `features/connection` provides it,
 * and only it ever sees a device token.
 */

/** A host this device has paired with. `deviceId` is unique per pairing, so it also keys the host. */
export interface PairedHost {
  readonly deviceId: EntityId;
  readonly hostName: string;
  readonly url: string;
}

/** The live link to the active host's event stream. */
export type LinkStatus =
  | { readonly kind: 'connecting'; readonly attempt: number }
  | { readonly kind: 'online' }
  /** The socket dropped; the next try is at `retryAt` (epoch ms). */
  | { readonly kind: 'reconnecting'; readonly attempt: number; readonly retryAt: number }
  /** The app is in the background, so the socket is closed. It reconnects as soon as the app is active. */
  | { readonly kind: 'paused' }
  /** The host unpaired this device. Nothing retries until it pairs again. */
  | { readonly kind: 'revoked' };

/** Whether the host serves `/api/ui/v1/*`. Until the probe answers, those routes are treated as missing. */
export type UiCapability = { readonly kind: 'unknown' } | { readonly kind: 'unavailable' } | { readonly kind: 'available' };

export type HostResult<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'unreachable'; readonly message: string }
  | { readonly kind: 'unauthorized' }
  /** A `/api/ui/v1` route on a host that does not serve them. Nothing was sent. */
  | { readonly kind: 'unsupported' }
  /** The host refused. `error` is the host's own when it sent one, otherwise `internal` naming the status. */
  | { readonly kind: 'failed'; readonly status: number; readonly error: ApiError['error'] }
  | { readonly kind: 'malformed'; readonly message: string };

export type HostMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A request: a JSON body when one is given, and the reply parsed with `reply` (unknown fields dropped). */
export interface HostRequest<T> {
  readonly method: HostMethod;
  readonly path: string;
  readonly reply: z.ZodType<T>;
  readonly body?: unknown;
}

/** An event in a thread's history, carrying the thread's cursor. */
export type ThreadEvent = Extract<EventServerFrame, { readonly cursor: Cursor }>;

/** A frame outside any thread's history, such as `usage.updated`. */
export type GlobalEvent = Exclude<EventServerFrame, ThreadEvent | { readonly kind: 'resync' }>;

/**
 * Follows one thread. Whenever the link opens again, and when the host asks for a resync, the
 * transport fetches the thread's `/state` first and only then subscribes from that state's cursor,
 * so every event applies to the state the watcher was given.
 */
export interface ThreadWatcher {
  /** The thread as the host has it now. Events after it follow; actions may run again. */
  readonly onFresh: (state: ThreadState) => void;
  /** The next event after the last state or event. Each is delivered once. */
  readonly onEvent: (event: ThreadEvent) => void;
  /**
   * The link dropped, the app went to the background, or the host asked for a resync. Keep
   * showing the last state marked as stale, with actions disabled, until the next `onFresh`.
   */
  readonly onStale: () => void;
  /** The host has no such thread (404). Nothing retries until the thread is watched again. */
  readonly onGone: () => void;
}

/**
 * How screens reach one host. A transport is per host; when a relay arrives it implements this
 * same interface, so screens do not change.
 */
export interface HostTransport {
  readonly host: PairedHost;
  readonly request: <T>(request: HostRequest<T>) => Promise<HostResult<T>>;
  /** Frames outside any thread. Thread events reach only that thread's watchers. */
  readonly listen: (listener: (event: GlobalEvent) => void) => () => void;
  /** Returns a function that stops watching. */
  readonly watchThread: (threadId: EntityId, watcher: ThreadWatcher) => () => void;
}

export interface ActiveHost {
  readonly host: PairedHost;
  readonly status: LinkStatus;
  readonly ui: UiCapability;
  readonly transport: HostTransport;
}

export type HostsState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly hosts: readonly PairedHost[]; readonly active: ActiveHost | null };

export type PairOutcome =
  | { readonly kind: 'paired'; readonly host: PairedHost }
  | { readonly kind: 'wrong-code' }
  | { readonly kind: 'rate-limited' }
  | { readonly kind: 'unreachable'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

/** What to tell the user when pairing did not work; null when it did. */
export function pairProblem(outcome: PairOutcome): string | null {
  switch (outcome.kind) {
    case 'paired':
      return null;
    case 'wrong-code':
      return 'That code is wrong or has expired. Make a new one on the desktop.';
    case 'rate-limited':
      return 'Too many wrong codes. Wait a minute, then try again.';
    case 'unreachable':
      return `Could not reach the host. Check that this phone is on the same network or Tailscale. (${outcome.message})`;
    case 'failed':
      return outcome.message;
  }
}

/** Whether a paired host answers right now, for hosts other than the active one. */
export type HostReachability = { readonly kind: 'online' } | { readonly kind: 'offline' } | { readonly kind: 'revoked' };

export interface HostConnection {
  readonly state: HostsState;
  /** Claims the code, saves the host in the Keychain and makes it active. */
  readonly pair: (target: PairingTarget) => Promise<PairOutcome>;
  readonly activate: (deviceId: EntityId) => void;
  /** Deletes this device's token for the host. The desktop still lists the device until it is unpaired there. */
  readonly forget: (deviceId: EntityId) => Promise<void>;
  readonly probe: (deviceId: EntityId) => Promise<HostReachability>;
  /** Reconnects the active host now instead of waiting out the backoff. */
  readonly retryNow: () => void;
}

export const HostConnectionContext = createContext<HostConnection | null>(null);

export function useHostConnection(): HostConnection {
  const connection = useContext(HostConnectionContext);
  if (connection === null) throw new Error('useHostConnection needs the connection Provider from the registry');
  return connection;
}
