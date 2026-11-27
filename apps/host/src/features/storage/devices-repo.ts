import type { DatabaseSync } from 'node:sqlite';
import { PairedDevice } from '@morrowbot/contracts';
import { z } from 'zod';

const DeviceRow = z
  .object({
    device_id: z.string(),
    device_name: z.string(),
    platform: z.string(),
    created_at: z.string(),
    last_seen_at: z.string(),
    revoked_at: z.string().nullable(),
  })
  .transform((row) => ({
    deviceId: row.device_id,
    deviceName: row.device_name,
    platform: row.platform,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
  }))
  .pipe(PairedDevice);

const IdRow = z.object({ device_id: z.string() });

export interface DeviceRepository {
  insert(device: PairedDevice, tokenHash: string): void;
  /** The device holding this token hash, unless it was revoked. */
  activeByTokenHash(tokenHash: string): string | undefined;
  touch(deviceId: string, at: string): void;
  list(): PairedDevice[];
  /** Keeps the first revocation time. False when no such device exists. */
  revoke(deviceId: string, at: string): boolean;
}

export function deviceRepository(db: DatabaseSync): DeviceRepository {
  const insert = db.prepare(
    `INSERT INTO paired_devices (device_id, device_name, platform, token_hash, created_at, last_seen_at, revoked_at)
     VALUES (:deviceId, :deviceName, :platform, :tokenHash, :createdAt, :lastSeenAt, NULL)`,
  );
  const active = db.prepare('SELECT device_id FROM paired_devices WHERE token_hash = ? AND revoked_at IS NULL');
  const touch = db.prepare('UPDATE paired_devices SET last_seen_at = ? WHERE device_id = ?');
  const list = db.prepare('SELECT * FROM paired_devices ORDER BY created_at, rowid');
  const revoke = db.prepare('UPDATE paired_devices SET revoked_at = COALESCE(revoked_at, ?) WHERE device_id = ?');
  return {
    insert: (device, tokenHash) => {
      insert.run({
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        platform: device.platform,
        tokenHash,
        createdAt: device.createdAt,
        lastSeenAt: device.lastSeenAt,
      });
    },
    activeByTokenHash: (tokenHash) => {
      const row = active.get(tokenHash);
      return row === undefined ? undefined : IdRow.parse(row).device_id;
    },
    touch: (deviceId, at) => {
      touch.run(at, deviceId);
    },
    list: () => list.all().map((row) => DeviceRow.parse(row)),
    revoke: (deviceId, at) => revoke.run(at, deviceId).changes > 0,
  };
}
