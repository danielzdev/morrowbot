import type { PairedDevice } from '@morrowbot/contracts';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { DeviceList } from './DeviceList.tsx';
import { PairCode, PairNeedsUrl } from './PairPanel.tsx';
import { activeDevices, afterMint, countdown, newlyPaired, type DevicesState, type PairingPort, type PairState } from './pairing.ts';
import { ROWS } from './settings-index.ts';
import { SettingRow } from './SettingRow.tsx';

const TICK_MS = 1_000;
const POLL_MS = 2_000;

/** Settings › Devices: pair a phone with a one-time code or its QR, and unpair devices. */
export function DevicesSection(props: { readonly pairing: PairingPort; readonly now?: () => number }) {
  const now = props.now ?? Date.now;
  const [devices, setDevices] = useState<DevicesState>({ kind: 'loading' });
  const [pair, setPair] = useState<PairState>({ kind: 'idle' });
  const [url, setUrl] = useState('');
  const [clock, setClock] = useState(now);
  const [unpairing, setUnpairing] = useState<PairedDevice | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const port = useRef(props.pairing);
  port.current = props.pairing;
  const live = useRef(true);
  const lastUrl = useRef<string | null>(null);
  const pairButton = useRef<HTMLButtonElement>(null);

  const load = async (): Promise<readonly PairedDevice[] | null> => {
    const result = await port.current.listDevices();
    if (!live.current) return null;
    if (result.kind === 'failed') {
      setDevices({ kind: 'failed', message: result.error.message });
      return null;
    }
    const active = activeDevices(result.value);
    setDevices({ kind: 'loaded', devices: active });
    setClock(now());
    return active;
  };

  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    if (pair.kind !== 'showing' && pair.kind !== 'minting' && pair.kind !== 'needs-url' && document.activeElement === document.body) pairButton.current?.focus();
    if (pair.kind !== 'showing') return;
    const { code, known } = pair;
    const tick = window.setInterval(() => {
      setClock(now());
    }, TICK_MS);
    const poll = window.setInterval(() => {
      if (countdown(code.expiresAt, now()) === null) return;
      void load().then((active) => {
        const added = active === null ? undefined : newlyPaired(active, known);
        if (added !== undefined) setPair((current) => (current === pair ? { kind: 'paired', deviceName: added.deviceName } : current));
      });
    }, POLL_MS);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
    };
  }, [pair]);

  const mint = async (typed: string | null): Promise<void> => {
    lastUrl.current = typed;
    setPair({ kind: 'minting' });
    const before = await load();
    if (before === null) {
      if (live.current) setPair({ kind: 'failed', message: "Couldn't reach MorrowBot's host. Try again." });
      return;
    }
    const result = await port.current.createPairingCode(typed);
    if (!live.current) return;
    setClock(now());
    setPair(afterMint(result, typed !== null, new Set(before.map(({ deviceId }) => deviceId))));
  };

  const unpair = async (device: PairedDevice): Promise<void> => {
    setUnpairing(null);
    setPair((current) => (current.kind === 'paired' ? { kind: 'idle' } : current));
    const result = await port.current.unpairDevice(device.deviceId);
    if (!live.current) return;
    setNotice(result.kind === 'ok' ? `Unpaired ${device.deviceName}.` : `Couldn't unpair ${device.deviceName}: ${result.error.message}`);
    await load();
  };

  const busy = pair.kind === 'minting';
  const panel = () => {
    switch (pair.kind) {
      case 'idle':
      case 'minting':
      case 'paired':
      case 'failed':
        return null;
      case 'showing':
        return (
          <PairCode
            code={pair.code}
            now={clock}
            onNewCode={() => void mint(lastUrl.current)}
            onDone={() => {
              setPair({ kind: 'idle' });
            }}
          />
        );
      case 'needs-url':
        return (
          <PairNeedsUrl
            url={url}
            error={pair.error}
            busy={busy}
            onUrl={setUrl}
            onSubmit={() => void mint(url.trim())}
            onCancel={() => {
              setPair({ kind: 'idle' });
            }}
          />
        );
    }
  };
  const status = pair.kind === 'paired' ? `Paired with ${pair.deviceName}.` : pair.kind === 'failed' ? pair.message : null;

  return (
    <>
      <SettingRow entry={ROWS.pairPhone}>
        {status !== null && (
          <span class="setting-note" role="status">
            {status}
          </span>
        )}
        <button ref={pairButton} type="button" class="btn primary" disabled={busy || pair.kind === 'showing' || pair.kind === 'needs-url'} onClick={() => void mint(null)}>
          {busy ? 'Making a code…' : 'Pair a phone'}
        </button>
      </SettingRow>
      {panel()}
      <SettingRow entry={ROWS.pairedDevices}>
        {devices.kind === 'loaded' && <span class="setting-note">{devices.devices.length === 1 ? '1 device' : `${String(devices.devices.length)} devices`}</span>}
      </SettingRow>
      {notice !== null && (
        <p class="setting-note devices-notice" role="status">
          {notice}
        </p>
      )}
      <DeviceList devices={devices} now={clock} onUnpair={setUnpairing} onRetry={() => void load()} />
      {unpairing !== null && (
        <ConfirmDialog
          title={`Unpair ${unpairing.deviceName}?`}
          body={<p>It is signed out at once and needs a new pairing code to connect again.</p>}
          confirmLabel="Unpair"
          tone="danger"
          onConfirm={() => void unpair(unpairing)}
          onCancel={() => {
            setUnpairing(null);
          }}
        />
      )}
    </>
  );
}
