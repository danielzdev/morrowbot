import { spawn } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseCleanupJob, type CleanupJob } from './cleanup-job.ts';
import { MAC_KEYCHAIN } from './keychain.ts';
import { runCleanup } from './run-cleanup.ts';

/**
 * The post-exit cleanup helper. Electron main starts it detached under Electron-as-Node with the job as
 * its one argument; it says `ready` once loaded, waits for main to exit, runs the job, logs what it did
 * to the temp folder, and after a reset opens MorrowBot again.
 */
const LOG = path.join(tmpdir(), 'morrowbot-reset.log');

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

function relaunch(job: CleanupJob): void {
  if (job.relaunch === null) return;
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'ELECTRON_RUN_AS_NODE'));
  spawn(job.relaunch.command, job.relaunch.args, { cwd: job.relaunch.cwd, env, detached: true, stdio: 'ignore' }).unref();
}

const log = (entry: unknown): Promise<void> => appendFile(LOG, `${new Date().toISOString()} ${JSON.stringify(entry)}\n`).catch(() => undefined);

const job = parseCleanupJob(process.argv[2]);
if (job === null) {
  await log({ kind: 'bad-job' });
  process.exit(2);
}
await new Promise<void>((resolve) => {
  if (process.send === undefined) resolve();
  else process.send({ kind: 'ready' }, undefined, undefined, () => { resolve(); });
});
process.disconnect?.();
const report = await runCleanup(job, { keychain: MAC_KEYCHAIN, isAlive, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) });
await log(report);
if (report.kind !== 'timed-out') relaunch(job);
