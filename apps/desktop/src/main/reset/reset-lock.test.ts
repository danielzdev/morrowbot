import { utimesSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { clearResetLock, resetInProgress, resetLockOf, touchResetLock, writeResetLock } from './reset-lock.ts';

it('blocks starting only while a live helper holds a recently refreshed lock for that data folder, spelt in any case', () => {
  const dataDir = `/Users/tester/.morrowbot-${randomUUID()}`;
  const alive = (pid: number) => pid === 4242;
  const none = resetInProgress(dataDir, alive);
  writeResetLock(dataDir, 4242);
  const running = resetInProgress(dataDir, alive);
  const otherCase = resetInProgress(dataDir.toUpperCase(), alive);
  const otherFolder = resetInProgress(`${dataDir}-other`, alive);
  const old = new Date(Date.now() - 31 * 60_000);
  utimesSync(resetLockOf(dataDir), old, old);
  const stale = resetInProgress(dataDir, alive);
  touchResetLock(dataDir);
  const refreshed = resetInProgress(dataDir, alive);
  writeResetLock(dataDir, 999);
  const helperGone = resetInProgress(dataDir, alive);
  clearResetLock(dataDir);
  expect({ none, running, otherCase, otherFolder, stale, refreshed, helperGone, cleared: resetInProgress(dataDir, alive) }).toEqual({
    none: false,
    running: true,
    otherCase: true,
    otherFolder: false,
    stale: false,
    refreshed: true,
    helperGone: false,
    cleared: false,
  });
});

it.skipIf(process.platform !== 'darwin')('finds the lock through any other path to the same data folder, such as the Data volume firmlink', () => {
  const dataDir = realpathSync(mkdtempSync(path.join(tmpdir(), 'morrowbot-lock-')));
  writeResetLock(dataDir, 4242);
  const alive = (pid: number) => pid === 4242;
  const viaFirmlink = resetInProgress(`/System/Volumes/Data${dataDir}`, alive);
  clearResetLock(dataDir);
  rmSync(dataDir, { recursive: true });
  expect(viaFirmlink).toBe(true);
});
