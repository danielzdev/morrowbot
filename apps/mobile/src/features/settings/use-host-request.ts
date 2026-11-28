import { useEffect, useState } from 'react';
import type { z } from 'zod';
import { useHostConnection, type HostResult } from '../../lib/host-connection.ts';

export type Loaded<T> =
  | { readonly kind: 'no-host' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly value: T }
  | { readonly kind: 'error'; readonly message: string };

/** GETs `path` from the active host, again whenever the host changes or comes back online. */
export function useHostGet<T>(path: string, reply: z.ZodType<T>): Loaded<T> {
  const connection = useHostConnection();
  const active = connection.state.kind === 'ready' ? connection.state.active : null;
  const transport = active?.transport ?? null;
  const online = active?.status.kind === 'online';
  const [loaded, setLoaded] = useState<Loaded<T>>({ kind: 'loading' });
  useEffect(() => {
    if (transport === null) {
      setLoaded({ kind: connection.state.kind === 'loading' ? 'loading' : 'no-host' });
      return;
    }
    let cancelled = false;
    setLoaded((previous) => (previous.kind === 'ready' ? previous : { kind: 'loading' }));
    void transport.request({ method: 'GET', path, reply }).then((result) => {
      if (!cancelled) setLoaded(toLoaded(result));
    });
    return () => {
      cancelled = true;
    };
  }, [transport, online, path, reply, connection.state.kind]);
  return loaded;
}

function toLoaded<T>(result: HostResult<T>): Loaded<T> {
  switch (result.kind) {
    case 'ok':
      return { kind: 'ready', value: result.value };
    case 'unreachable':
      return { kind: 'error', message: "Can't reach the host right now." };
    case 'unauthorized':
      return { kind: 'error', message: 'This phone was unpaired on the desktop. Pair it again in Connections.' };
    case 'unsupported':
      return { kind: 'error', message: 'This host does not offer this yet.' };
    case 'failed':
      return { kind: 'error', message: result.message };
    case 'malformed':
      return { kind: 'error', message: 'The host sent something this app cannot read. Update MorrowBot on both devices.' };
  }
}
