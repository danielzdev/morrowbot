import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { ClaimPairingRequest, PairedDevice } from '@morrowbot/contracts';

export const CODE_LIFETIME_MS = 5 * 60_000;
/** Wrong codes one source may send per window before its claims pause. */
export const MAX_FAILED_CLAIMS = 5;
export const FAILED_CLAIM_WINDOW_MS = 60_000;
/** Wrong codes, from any sources, after which the open code is cancelled: at most this many guesses per code. */
export const MAX_GUESSES_PER_CODE = 20;
/** How often a device's `lastSeenAt` is written at most. */
export const LAST_SEEN_EVERY_MS = 60_000;

/** Where paired devices are kept (the storage feature provides one). */
export interface DeviceRecords {
  insert(device: PairedDevice, tokenHash: string): void;
  activeByTokenHash(tokenHash: string): string | undefined;
  touch(deviceId: string, at: string): void;
  list(): PairedDevice[];
  revoke(deviceId: string, at: string): boolean;
}

export interface PairingServiceOptions {
  readonly records: DeviceRecords;
  readonly newId: () => string;
  readonly now: () => string;
}

export type ClaimResult =
  | { readonly kind: 'claimed'; readonly deviceId: string; readonly token: string }
  | { readonly kind: 'wrong-code' }
  | { readonly kind: 'rate-limited' };

export interface PairingService {
  /** Starts a new code and cancels any earlier one, so at most one code is ever open. */
  createCode(): { readonly code: string; readonly expiresAt: string };
  /** `source` is the peer's address. A claim while no code is open is refused without counting as a guess. */
  claim(request: ClaimPairingRequest, source: string): ClaimResult;
  /** The active device holding `token`, marked as seen (written at most once a minute). */
  authenticate(token: string): string | undefined;
  list(): PairedDevice[];
  revoke(deviceId: string): boolean;
}

export function createPairingService(options: PairingServiceOptions): PairingService {
  const { records, now } = options;
  let open: { readonly code: string; readonly expiresAtMs: number; guesses: number } | undefined;
  const failures = new Map<string, number[]>();
  const lastWritten = new Map<string, number>();
  return {
    createCode: () => {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const expiresAtMs = Date.parse(now()) + CODE_LIFETIME_MS;
      open = { code, expiresAtMs, guesses: 0 };
      return { code, expiresAt: new Date(expiresAtMs).toISOString() };
    },
    claim: (request, source) => {
      const at = now();
      const atMs = Date.parse(at);
      for (const [key, times] of failures) {
        const recent = times.filter((failedAt) => atMs - failedAt < FAILED_CLAIM_WINDOW_MS);
        if (recent.length === 0) failures.delete(key);
        else failures.set(key, recent);
      }
      if (open === undefined || atMs >= open.expiresAtMs) {
        open = undefined;
        return { kind: 'wrong-code' };
      }
      const recent = failures.get(source) ?? [];
      if (recent.length >= MAX_FAILED_CLAIMS) return { kind: 'rate-limited' };
      if (!sameCode(open.code, request.code)) {
        failures.set(source, [...recent, atMs]);
        open.guesses += 1;
        if (open.guesses >= MAX_GUESSES_PER_CODE) open = undefined;
        return { kind: 'wrong-code' };
      }
      open = undefined;
      const token = randomBytes(32).toString('base64url');
      const device: PairedDevice = {
        deviceId: options.newId(),
        deviceName: request.deviceName,
        platform: request.platform,
        createdAt: at,
        lastSeenAt: at,
        revokedAt: null,
      };
      records.insert(device, hashToken(token));
      lastWritten.set(device.deviceId, atMs);
      return { kind: 'claimed', deviceId: device.deviceId, token };
    },
    authenticate: (token) => {
      if (token === '') return undefined;
      const deviceId = records.activeByTokenHash(hashToken(token));
      if (deviceId === undefined) return undefined;
      const at = now();
      const atMs = Date.parse(at);
      const written = lastWritten.get(deviceId);
      if (written === undefined || atMs - written >= LAST_SEEN_EVERY_MS) {
        records.touch(deviceId, at);
        lastWritten.set(deviceId, atMs);
      }
      return deviceId;
    },
    list: () => records.list(),
    revoke: (deviceId) => {
      lastWritten.delete(deviceId);
      return records.revoke(deviceId, now());
    },
  };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function sameCode(expected: string, given: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
