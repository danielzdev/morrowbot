import { useEffect, useState } from 'react';
import type { z } from 'zod';
import { useHostConnection, type HostResult, type HostTransport } from '../../lib/host-connection.ts';

export type Loaded<T> =
  | { readonly kind: 'no-host' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly value: T }
  /** The last value, shown while the link is down or a fresh one is on its way. It may be out of date. */
  | { readonly kind: 'stale'; readonly value: T }
  | { readonly kind: 'error'; readonly message: string };

/** The value to show, fresh or stale. */
export function loadedValue<T>(loaded: Loaded<T>): T | null {
  return loaded.kind === 'ready' || loaded.kind === 'stale' ? loaded.value : null;
}

interface Fetched<T> {
  readonly path: string;
  readonly transport: HostTransport;
  readonly result: HostResult<T>;
  /** False once the link has dropped or a refetch has started since this result arrived. */
  readonly current: boolean;
}

const UNREACHABLE = "Can't reach the host right now.";
const UNPAIRED = 'This phone was unpaired on the desktop. Pair it again in Connections.';

/** GETs `path` from the active host while it is online, again whenever the host changes or comes back. */
export function useHostGet<T>(path: string, reply: z.ZodType<T>): Loaded<T> {
  const connection = useHostConnection();
  const active = connection.state.kind === 'ready' ? connection.state.active : null;
  const transport = active?.transport ?? null;
  const status = active?.status.kind ?? null;
  const online = status === 'online';
  const [fetched, setFetched] = useState<Fetched<T> | null>(null);
  useEffect(() => {
    if (transport === null || !online) return;
    let cancelled = false;
    setFetched((previous) => (previous === null ? null : { ...previous, current: false }));
    void transport.request({ method: 'GET', path, reply }).then((result) => {
      if (!cancelled) setFetched({ path, transport, result, current: true });
    });
    return () => {
      cancelled = true;
    };
  }, [transport, online, path, reply]);

  if (connection.state.kind === 'loading') return { kind: 'loading' };
  if (transport === null) return { kind: 'no-host' };
  const mine = fetched !== null && fetched.path === path && fetched.transport === transport ? fetched : null;
  const current = online && mine?.current === true;
  if (mine?.result.kind === 'ok') return current ? { kind: 'ready', value: mine.result.value } : { kind: 'stale', value: mine.result.value };
  if (current) return toLoaded(mine.result);
  if (online || status === 'connecting') return { kind: 'loading' };
  return { kind: 'error', message: status === 'revoked' ? UNPAIRED : UNREACHABLE };
}

function toLoaded<T>(result: HostResult<T>): Loaded<T> {
  switch (result.kind) {
    case 'ok':
      return { kind: 'ready', value: result.value };
    case 'unreachable':
      return { kind: 'error', message: UNREACHABLE };
    case 'unauthorized':
      return { kind: 'error', message: UNPAIRED };
    case 'unsupported':
      return { kind: 'error', message: 'This host does not offer this yet.' };
    case 'failed':
      return { kind: 'error', message: result.message };
    case 'malformed':
      return { kind: 'error', message: 'The host sent something this app cannot read. Update MorrowBot on both devices.' };
  }
}
