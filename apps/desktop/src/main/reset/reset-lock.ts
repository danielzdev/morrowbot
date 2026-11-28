import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { comparable } from './reset-paths.ts';

/** The helper refreshes its lock before every step; one not refreshed for this long belongs to no running cleanup. */
const STALE_MS = 30 * 60_000;

/**
 * The lock a running cleanup holds for one data folder, in the temp folder so deleting the data folder leaves it.
 * Keyed by the folder as APFS compares it, so `~/.MorrowBot` finds the lock for `~/.morrowbot`.
 */
export const resetLockOf = (dataDir: string): string =>
  path.join(tmpdir(), `morrowbot-reset-${createHash('sha256').update(comparable(dataDir)).digest('hex').slice(0, 16)}.lock`);

/** True while `pid` runs (EPERM: it runs as another user). */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

export function writeResetLock(dataDir: string, helperPid: number): void {
  writeFileSync(resetLockOf(dataDir), String(helperPid));
}

/** Marks the lock fresh again; a lock that is gone stays gone. */
export function touchResetLock(dataDir: string): void {
  const lock = resetLockOf(dataDir);
  const now = new Date();
  if (existsSync(lock)) utimesSync(lock, now, now);
}

export function clearResetLock(dataDir: string): void {
  rmSync(resetLockOf(dataDir), { force: true });
}

/** True while a cleanup helper for this data folder is still at work: MorrowBot must not start on half-deleted data. */
export function resetInProgress(dataDir: string, alive: (pid: number) => boolean = isAlive, now: number = Date.now()): boolean {
  try {
    const lock = resetLockOf(dataDir);
    const pid = Number(readFileSync(lock, 'utf8'));
    return now - statSync(lock).mtimeMs < STALE_MS && Number.isInteger(pid) && pid > 0 && alive(pid);
  } catch {
    return false;
  }
}
