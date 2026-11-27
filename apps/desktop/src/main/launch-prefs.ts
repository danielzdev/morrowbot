import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const LaunchPrefs = z.strictObject({ safeMode: z.boolean() });

const fileOf = (dataDir: string): string => path.join(dataDir, 'launch.json');

/** Whether this launch starts the host in safe mode, as the user chose before the last restart. A missing or unreadable file means no. */
export function readSafeMode(dataDir: string): boolean {
  try {
    const parsed = LaunchPrefs.safeParse(JSON.parse(readFileSync(fileOf(dataDir), 'utf8')));
    return parsed.success && parsed.data.safeMode;
  } catch {
    return false;
  }
}

/** Saves the safe-mode choice for the next launch, replacing the file atomically. */
export function writeSafeMode(dataDir: string, safeMode: boolean): void {
  mkdirSync(dataDir, { recursive: true });
  const file = fileOf(dataDir);
  writeFileSync(`${file}.tmp`, JSON.stringify({ safeMode }));
  renameSync(`${file}.tmp`, file);
}
