import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { ClaimPairingRequest, PairedDevice } from '@morrowbot/contracts';

export const CODE_LIFETIME_MS = 5 * 60_000;
/** Wrong codes allowed per window before claims pause and the current code is cancelled. */
export const MAX_FAILED_CLAIMS = 5;
export const FAILED_CLAIM_WINDOW_MS = 60_000;

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
  claim(request: ClaimPairingRequest): ClaimResult;
  /** The active device holding `token`, marked as seen now. */
  authenticate(token: string): string | undefined;
  list(): PairedDevice[];
  revoke(deviceId: string): boolean;
}

export function createPairingService(options: PairingServiceOptions): PairingService {
  const { records, now } = options;
  let open: { readonly code: string; readonly expiresAtMs: number } | undefined;
  let failures: number[] = [];
  return {
    createCode: () => {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const expiresAtMs = Date.parse(now()) + CODE_LIFETIME_MS;
      open = { code, expiresAtMs };
      return { code, expiresAt: new Date(expiresAtMs).toISOString() };
    },
    claim: (request) => {
      const at = now();
      const atMs = Date.parse(at);
      failures = failures.filter((failedAt) => atMs - failedAt < FAILED_CLAIM_WINDOW_MS);
      if (failures.length >= MAX_FAILED_CLAIMS) return { kind: 'rate-limited' };
      if (open === undefined || atMs >= open.expiresAtMs || !sameCode(open.code, request.code)) {
        failures.push(atMs);
        if (failures.length >= MAX_FAILED_CLAIMS) open = undefined;
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
      return { kind: 'claimed', deviceId: device.deviceId, token };
    },
    authenticate: (token) => {
      if (token === '') return undefined;
      const deviceId = records.activeByTokenHash(hashToken(token));
      if (deviceId !== undefined) records.touch(deviceId, now());
      return deviceId;
    },
    list: () => records.list(),
    revoke: (deviceId) => records.revoke(deviceId, now()),
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
