import type { Cursor, EntityId, EventServerFrame } from '@morrowbot/contracts';
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
  | { readonly kind: 'failed'; readonly status: number; readonly message: string }
  | { readonly kind: 'malformed'; readonly message: string };

export type HostMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A request: a JSON body when one is given, and the reply parsed with `reply` (unknown fields dropped). */
export interface HostRequest<T> {
  readonly method: HostMethod;
  readonly path: string;
  readonly reply: z.ZodType<T>;
  readonly body?: unknown;
}

/** A thread's events after `since`. On `resync`, refetch the thread's state and `resume` at its cursor. */
export interface ThreadWatch {
  readonly resume: (since: Cursor | null) => void;
  readonly close: () => void;
}

/**
 * How screens reach one host. A transport is per host; when a relay arrives it implements this
 * same interface, so screens do not change.
 */
export interface HostTransport {
  readonly host: PairedHost;
  readonly request: <T>(request: HostRequest<T>) => Promise<HostResult<T>>;
  /** Every frame from the host: global events, and events of threads being watched. */
  readonly listen: (listener: (frame: EventServerFrame) => void) => () => void;
  readonly watchThread: (threadId: EntityId, since: Cursor | null) => ThreadWatch;
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
