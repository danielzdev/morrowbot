import { z } from 'zod';
import { EntityId, Timestamp } from './ids.ts';

/** A one-time code shown by the desktop and typed or scanned on the device. */
export const PairingCode = z.string().regex(/^\d{6}$/, 'Expected a 6-digit code');
export type PairingCode = z.infer<typeof PairingCode>;

export const DevicePlatform = z.enum(['ios', 'android', 'macos', 'windows', 'linux']);
export type DevicePlatform = z.infer<typeof DevicePlatform>;

/** Where a device reaches the host, such as `http://100.64.0.1:47800`. Parsed to its origin (one spelling per endpoint). */
export const HostUrl = z
  .url({ protocol: /^https?$/ })
  .refine((value) => {
    const url = URL.parse(value);
    return url !== null && url.pathname === '/' && url.search === '' && url.hash === '' && url.username === '' && url.password === '';
  }, 'Use only the scheme, host and port')
  .transform((value) => new URL(value).origin);
export type HostUrl = z.infer<typeof HostUrl>;

/** `url` is the address the device should use; it defaults to the host's own LAN or Tailscale listen address. */
export const CreatePairingCodeRequest = z.strictObject({ url: HostUrl.optional() });
export type CreatePairingCodeRequest = z.infer<typeof CreatePairingCodeRequest>;

export const PairingCodeResponse = z.strictObject({
  code: PairingCode,
  expiresAt: Timestamp,
  url: HostUrl,
  /** The QR payload: `morrowbot://pair?url=<url>&code=<code>`. */
  pairingUri: z.string().startsWith('morrowbot://pair?'),
});
export type PairingCodeResponse = z.infer<typeof PairingCodeResponse>;

export const ClaimPairingRequest = z.strictObject({
  code: PairingCode,
  deviceName: z.string().trim().min(1).max(100),
  platform: DevicePlatform,
});
export type ClaimPairingRequest = z.infer<typeof ClaimPairingRequest>;

export const ClaimPairingResponse = z.strictObject({
  deviceId: EntityId,
  /** The device's long-lived Bearer token. The host keeps only its hash and never shows it again. */
  token: z.string().min(32),
  hostName: z.string().min(1),
  hostVersion: z.string().min(1),
});
export type ClaimPairingResponse = z.infer<typeof ClaimPairingResponse>;

export const PairedDevice = z.strictObject({
  deviceId: EntityId,
  deviceName: z.string().min(1),
  platform: DevicePlatform,
  createdAt: Timestamp,
  lastSeenAt: Timestamp,
  /** Set once the device is unpaired; its token stops working at that moment. */
  revokedAt: Timestamp.nullable(),
});
export type PairedDevice = z.infer<typeof PairedDevice>;

export const PairedDeviceList = z.strictObject({ devices: z.array(PairedDevice) });
export type PairedDeviceList = z.infer<typeof PairedDeviceList>;

/** The QR payload for a pairing code. */
export function pairingUri(url: HostUrl, code: PairingCode): string {
  return `morrowbot://pair?${new URLSearchParams({ url, code }).toString()}`;
}
