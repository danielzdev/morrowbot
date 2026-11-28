import type { DevicePlatform, PairedDevice, PairedDeviceList, PairingCodeResponse } from '@morrowbot/contracts';
import type { Api, ApiResult } from '../../shared/api.ts';
import { relativeTime } from '../../shared/format.ts';

/** The host calls Settings › Devices makes. */
export type PairingPort = Pick<Api, 'createPairingCode' | 'listDevices' | 'unpairDevice'>;

/** The "Pair a phone" flow, from the button to a phone claiming the code. */
export type PairState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'minting' }
  /** The host listens on no one address phones can reach, so it needs the address they should use. */
  | { readonly kind: 'needs-url'; readonly error: string | null }
  /** `known` holds the devices paired before this code, so a new one is noticed. */
  | { readonly kind: 'showing'; readonly code: PairingCodeResponse; readonly known: ReadonlySet<string> }
  | { readonly kind: 'paired'; readonly deviceName: string }
  | { readonly kind: 'failed'; readonly message: string };

export type DevicesState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly devices: readonly PairedDevice[] }
  | { readonly kind: 'failed'; readonly message: string };

const CONFLICT = 409;
const BAD_REQUEST = 400;

/** What a pairing-code reply shows. `typedUrl` says whether the user gave the address. */
export function afterMint(result: ApiResult<PairingCodeResponse>, typedUrl: boolean, known: ReadonlySet<string>): PairState {
  if (result.kind === 'ok') return { kind: 'showing', code: result.value, known };
  if (result.status === CONFLICT) return { kind: 'needs-url', error: null };
  if (typedUrl && result.status === BAD_REQUEST) return { kind: 'needs-url', error: 'Use an address such as http://100.64.0.1:47800: the scheme, host and port only.' };
  return { kind: 'failed', message: result.error.message };
}

/** Devices that can still reach the host, newest first. */
export function activeDevices(list: PairedDeviceList): readonly PairedDevice[] {
  return list.devices.filter(({ revokedAt }) => revokedAt === null).toReversed();
}

/** The first active device paired after the code was shown, if any. */
export function newlyPaired(devices: readonly PairedDevice[], known: ReadonlySet<string>): PairedDevice | undefined {
  return devices.find(({ deviceId }) => !known.has(deviceId));
}

/** Time left on a code as `m:ss`, or null once it has expired. */
export function countdown(expiresAt: string, now: number): string | null {
  const left = Math.ceil((Date.parse(expiresAt) - now) / 1000);
  if (left <= 0) return null;
  return `${String(Math.floor(left / 60))}:${String(left % 60).padStart(2, '0')}`;
}

/** A code split in two for reading aloud: `042 137`. */
export const spacedCode = (code: string): string => `${code.slice(0, 3)} ${code.slice(3)}`;

export function platformLabel(platform: DevicePlatform): string {
  switch (platform) {
    case 'ios':
      return 'iOS';
    case 'android':
      return 'Android';
    case 'macos':
      return 'macOS';
    case 'windows':
      return 'Windows';
    case 'linux':
      return 'Linux';
  }
}

export function isPhone(platform: DevicePlatform): boolean {
  switch (platform) {
    case 'ios':
    case 'android':
      return true;
    case 'macos':
    case 'windows':
    case 'linux':
      return false;
  }
}

/** The line under a device's name: its platform and when it last reached the host. */
export function deviceDetail(device: PairedDevice, now: number): string {
  const age = relativeTime(device.lastSeenAt, now);
  return `${platformLabel(device.platform)} · Last seen ${age === 'now' ? 'just now' : `${age} ago`}`;
}
