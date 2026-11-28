import { spawn } from 'node:child_process';
import { appendFile, realpath } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { jobRefusal, parseCleanupJob, type Relaunch } from './cleanup-job.ts';
import { MAC_KEYCHAIN } from './keychain.ts';
import { clearResetLock, isAlive } from './reset-lock.ts';
import { runCleanup } from './run-cleanup.ts';

/**
 * The post-exit cleanup helper. Electron main starts it detached under Electron-as-Node with the job as
 * its one argument. It checks the job against its own platform, home and binary, says `ready` once
 * loaded, and acts only after main sends `commit`: if main disconnects first, it does nothing. Then it
 * waits for main to exit, runs the job, logs what it did to the temp folder, and after a reset opens
 * MorrowBot again.
 */
const LOG = path.join(tmpdir(), 'morrowbot-reset.log');
const Commit = z.strictObject({ kind: z.literal('commit') });

function relaunch(target: Relaunch): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'ELECTRON_RUN_AS_NODE'));
  spawn(target.command, target.args, { cwd: target.cwd, env, detached: true, stdio: 'ignore' }).unref();
}

const log = (entry: unknown): Promise<void> => appendFile(LOG, `${new Date().toISOString()} ${JSON.stringify(entry)}\n`).catch(() => undefined);

const job = parseCleanupJob(process.argv[2]);
if (job === null) {
  await log({ kind: 'bad-job' });
  process.exit(2);
}
const refusal = process.send === undefined ? 'Not started by MorrowBot.' : jobRefusal(job, { platform: process.platform, homeDir: await realpath(homedir()), execPath: process.execPath });
if (refusal !== null) {
  await log({ kind: 'refused', reason: refusal });
  process.exit(2);
}
const committed = await new Promise<boolean>((resolve) => {
  process.on('message', (message) => {
    if (Commit.safeParse(message).success) resolve(true);
  });
  process.once('disconnect', () => {
    resolve(false);
  });
  process.send?.({ kind: 'ready' });
});
if (process.connected) process.disconnect?.();
if (!committed) {
  await log({ kind: 'cancelled' });
  process.exit(0);
}
const report = await runCleanup(job, { keychain: MAC_KEYCHAIN, isAlive, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) });
clearResetLock(job.context.profile.dataDir);
await log(report);
if (report.kind !== 'timed-out' && job.choice.kind === 'reset') relaunch(job.choice.relaunch);
