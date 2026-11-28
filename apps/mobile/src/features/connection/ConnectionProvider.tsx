import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { HostConnectionContext, type HostConnection, type HostsState, type PairedHost } from '../../lib/host-connection.ts';
import { reconnectDelay } from './backoff.ts';
import { claimPairing, probeHost } from './claim.ts';
import { connectHost, type LiveTransport, type TransportDeps, type TransportState } from './host-transport.ts';
import { keychainStore } from './keychain-store.ts';
import { openNativeSocket } from './native-socket.ts';
import { usePairingLinks } from './pairing-links.ts';
import { loadHosts, saveHosts, withActive, withHost, withoutHost, type HostProfile, type SavedHosts } from './saved-hosts.ts';

const report = (problem: string): void => {
  console.warn(`Ori Kami connection: ${problem}`);
};

const DEPS: TransportDeps = {
  fetch,
  openSocket: openNativeSocket,
  delayFor: (attempt) => reconnectDelay(attempt, Math.random),
  now: Date.now,
  report,
};

function deviceName(): string {
  return Platform.OS === 'ios' && Platform.isPad ? 'iPad' : 'iPhone';
}

function toPaired(profile: HostProfile): PairedHost {
  return { deviceId: profile.deviceId, hostName: profile.hostName, url: profile.url };
}

interface Live {
  readonly profile: HostProfile;
  readonly link: LiveTransport;
  readonly state: TransportState;
}

/** Owns the saved hosts (in the Keychain) and the live transport to the active one. */
export function ConnectionProvider(props: { readonly children: ReactNode }) {
  const [saved, setSaved] = useState<SavedHosts | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const savedRef = useRef<SavedHosts | null>(null);
  const writes = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    void loadHosts(keychainStore, report).then((loaded) => {
      if (cancelled) return;
      savedRef.current = loaded;
      setSaved(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const active = saved?.hosts.find((host) => host.deviceId === saved.activeDeviceId) ?? null;
  useEffect(() => {
    if (active === null) {
      setLive(null);
      return;
    }
    const link = connectHost(active, DEPS, (state) => {
      setLive((current) => (current?.link === link ? { ...current, state } : current));
    });
    setLive({ profile: active, link, state: { status: { kind: 'connecting', attempt: 0 }, ui: { kind: 'unknown' } } });
    return link.close;
  }, [active]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') live?.link.pause();
      else if (next === 'active') live?.link.wake();
    });
    return () => {
      subscription.remove();
    };
  }, [live?.link]);

  const connection = useMemo<HostConnection>(() => {
    /** Applies a change to the saved hosts now, and writes it to the Keychain after earlier writes. */
    const commit = (change: (current: SavedHosts) => SavedHosts): Promise<void> => {
      const current = savedRef.current;
      if (current === null) return Promise.resolve();
      const next = change(current);
      savedRef.current = next;
      setSaved(next);
      writes.current = writes.current.then(() => saveHosts(keychainStore, next)).catch((error: unknown) => {
        report(`Could not save hosts: ${String(error)}`);
      });
      return writes.current;
    };
    const profileOf = (deviceId: string): HostProfile | undefined => savedRef.current?.hosts.find((host) => host.deviceId === deviceId);
    const state: HostsState =
      saved === null
        ? { kind: 'loading' }
        : {
            kind: 'ready',
            hosts: saved.hosts.map(toPaired),
            active:
              live === null || live.profile !== active
                ? null
                : { host: live.link.transport.host, status: live.state.status, ui: live.state.ui, transport: live.link.transport },
          };
    return {
      state,
      pair: async (target) => {
        const result = await claimPairing(fetch, target, deviceName());
        if (result.kind !== 'claimed') return result;
        await commit((current) => withHost(current, result.profile));
        return { kind: 'paired', host: toPaired(result.profile) };
      },
      activate: (deviceId) => {
        void commit((current) => withActive(current, deviceId));
      },
      forget: (deviceId) => commit((current) => withoutHost(current, deviceId)),
      probe: async (deviceId) => {
        const profile = profileOf(deviceId);
        return profile === undefined ? { kind: 'revoked' } : probeHost(fetch, profile);
      },
      retryNow: () => {
        live?.link.wake();
      },
    };
  }, [saved, live, active]);

  usePairingLinks(connection.pair);

  return <HostConnectionContext.Provider value={connection}>{props.children}</HostConnectionContext.Provider>;
}
