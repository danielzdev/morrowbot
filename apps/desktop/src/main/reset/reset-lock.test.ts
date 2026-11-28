import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { clearResetLock, resetInProgress, writeResetLock } from './reset-lock.ts';

it('blocks starting only while a live helper holds a fresh lock for that data folder', () => {
  const dataDir = `/Users/tester/.morrowbot-${randomUUID()}`;
  const alive = (pid: number) => pid === 4242;
  const none = resetInProgress(dataDir, alive);
  writeResetLock(dataDir, 4242);
  const running = resetInProgress(dataDir, alive);
  const otherFolder = resetInProgress(`${dataDir}-other`, alive);
  const stale = resetInProgress(dataDir, alive, Date.now() + 10 * 60_000);
  writeResetLock(dataDir, 999);
  const helperGone = resetInProgress(dataDir, alive);
  clearResetLock(dataDir);
  expect({ none, running, otherFolder, stale, helperGone, cleared: resetInProgress(dataDir, alive) }).toEqual({
    none: false,
    running: true,
    otherFolder: false,
    stale: false,
    helperGone: false,
    cleared: false,
  });
});
