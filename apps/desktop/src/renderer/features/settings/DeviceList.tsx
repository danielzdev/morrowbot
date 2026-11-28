import type { PairedDevice } from '@morrowbot/contracts';
import { Icon } from '../../shared/ui/Icon.tsx';
import { deviceDetail, isPhone, type DevicesState } from './pairing.ts';

/** The devices that can reach this host, each with Unpair. */
export function DeviceList(props: {
  readonly devices: DevicesState;
  readonly now: number;
  readonly onUnpair: (device: PairedDevice) => void;
  readonly onRetry: () => void;
}) {
  const { devices } = props;
  switch (devices.kind) {
    case 'loading':
      return <p class="muted devices-empty">Loading devices…</p>;
    case 'failed':
      return (
        <div class="banner error devices-banner" role="alert">
          <span>{devices.message}</span>
          <button type="button" class="btn secondary" onClick={props.onRetry}>
            Try again
          </button>
        </div>
      );
    case 'loaded':
      if (devices.devices.length === 0) return <p class="muted devices-empty">No devices yet. Pair a phone to chat with your agents on the go.</p>;
      return (
        <ul class="device-list" aria-label="Paired devices">
          {devices.devices.map((device) => (
            <li key={device.deviceId} class="device-row">
              <span class="device-icon">
                <Icon name={isPhone(device.platform) ? 'phone' : 'monitor'} />
              </span>
              <div class="device-text">
                <div class="device-name">{device.deviceName}</div>
                <div class="device-detail">{deviceDetail(device, props.now)}</div>
              </div>
              <button
                type="button"
                class="btn secondary"
                aria-label={`Unpair ${device.deviceName}`}
                onClick={() => {
                  props.onUnpair(device);
                }}
              >
                Unpair
              </button>
            </li>
          ))}
        </ul>
      );
  }
}
