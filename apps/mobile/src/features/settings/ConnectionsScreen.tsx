import { useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Alert } from 'react-native';
import { useHostConnection, type HostConnection, type HostReachability, type PairedHost } from '../../lib/host-connection.ts';
import { Check, Group, GroupedScroll, IconTile, Note, Row, StatusDot } from './grouped.tsx';
import { describeLink, describeReachability, type StatusLabel } from './link-status.ts';
import { settingsUi } from './settings-store.ts';
import { useClock } from './use-clock.ts';

/** Paired hosts: which one is active, whether each answers, and adding or forgetting one. */
export function ConnectionsScreen() {
  const connection = useHostConnection();
  const now = useClock();
  const { state } = connection;
  const reachability = useReachability(connection);
  if (state.kind === 'loading') return <Note text="Loading hosts…" />;
  const { hosts, active } = state;

  const statusOf = (host: PairedHost): StatusLabel =>
    active?.host.deviceId === host.deviceId ? describeLink(active.status, now) : describeReachability(reachability.get(host.deviceId) ?? null);

  return (
    <GroupedScroll>
      <Group
        header="Hosts"
        footer={
          hosts.length === 0
            ? 'Pair this phone with Ori Kami on your computer over your home network or Tailscale.'
            : 'Tap a host to use it. Forgetting a host deletes this phone’s key; to cut it off everywhere, also unpair the phone on the desktop.'
        }
      >
        {hosts.map((host) => {
          const isActive = active?.host.deviceId === host.deviceId;
          const status = statusOf(host);
          return (
            <Row
              key={host.deviceId}
              label={host.hostName}
              detail={`${status.label} · ${host.url}`}
              leading={<StatusDot tone={status.tone} />}
              trailing={isActive ? <Check /> : null}
              tone="default"
              selected={false}
              onPress={() => {
                if (isActive) hostActions(connection, host, active.status.kind !== 'online');
                else connection.activate(host.deviceId);
              }}
              onLongPress={() => {
                hostActions(connection, host, false);
              }}
            />
          );
        })}
        <Row
          label="Add Host"
          detail="Scan the QR code or enter the 6-digit code"
          leading={<IconTile symbol="plus" />}
          trailing={null}
          tone="accent"
          selected={false}
          onPress={settingsUi.openPairing}
        />
      </Group>
    </GroupedScroll>
  );
}

type HostAction = { readonly kind: 'reconnect' | 'forget' | 'cancel'; readonly label: string };

function hostActions(connection: HostConnection, host: PairedHost, offerReconnect: boolean): void {
  const actions: readonly HostAction[] = [
    ...(offerReconnect ? [{ kind: 'reconnect', label: 'Reconnect Now' } satisfies HostAction] : []),
    { kind: 'forget', label: 'Forget This Host' },
    { kind: 'cancel', label: 'Cancel' },
  ];
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: host.hostName,
      message: host.url,
      options: actions.map((action) => action.label),
      destructiveButtonIndex: actions.findIndex((action) => action.kind === 'forget'),
      cancelButtonIndex: actions.length - 1,
    },
    (index) => {
      const chosen = actions[index];
      if (chosen === undefined) return;
      switch (chosen.kind) {
        case 'reconnect':
          connection.retryNow();
          return;
        case 'forget':
          confirmForget(connection, host);
          return;
        case 'cancel':
          return;
      }
    },
  );
}

function confirmForget(connection: HostConnection, host: PairedHost): void {
  Alert.alert(`Forget ${host.hostName}?`, 'This phone stops connecting to it. You can pair again with a new code.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Forget',
      style: 'destructive',
      onPress: () => {
        void connection.forget(host.deviceId);
      },
    },
  ]);
}

/** Probes each saved host other than the active one once per visit. */
function useReachability(connection: HostConnection): ReadonlyMap<string, HostReachability> {
  const [reachability, setReachability] = useState<ReadonlyMap<string, HostReachability>>(new Map());
  const { state } = connection;
  const probe = useRef(connection.probe);
  probe.current = connection.probe;
  const others = state.kind === 'ready' ? state.hosts.filter((host) => host.deviceId !== state.active?.host.deviceId).map((host) => host.deviceId) : [];
  const key = others.join(',');
  useEffect(() => {
    let cancelled = false;
    for (const deviceId of key === '' ? [] : key.split(',')) {
      void probe.current(deviceId).then((result) => {
        if (!cancelled) setReachability((current) => new Map(current).set(deviceId, result));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [key]);
  return reachability;
}
