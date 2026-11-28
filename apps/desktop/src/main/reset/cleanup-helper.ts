import { spawn } from 'node:child_process';
import { appendFile, realpath } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { jobRefusal, parseJobMessage, type Relaunch } from './cleanup-job.ts';
import { MAC_KEYCHAIN } from './keychain.ts';
import { clearResetLock, isAlive, touchResetLock } from './reset-lock.ts';
import { runCleanup } from './run-cleanup.ts';

/**
 * The post-exit cleanup helper. Electron main starts it detached under Electron-as-Node and sends the job over
 * IPC. It checks the job against its own platform, home and binary, says `ready`, and acts only after main
 * sends `commit`, which it confirms with `committed`; if main disconnects first, it does nothing. Then it waits
 * for main to exit, runs the job, logs what it did to the temp folder, and after a reset opens Ori Kami again.
 */
const LOG = path.join(tmpdir(), 'orikami-reset.log');
const Commit = z.strictObject({ kind: z.literal('commit') });

const log = (entry: unknown): Promise<void> => appendFile(LOG, `${new Date().toISOString()} ${JSON.stringify(entry)}\n`).catch(() => undefined);

async function stop(code: number, entry: unknown): Promise<never> {
  await log(entry);
  process.exit(code);
}

function relaunch(target: Relaunch): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'ELECTRON_RUN_AS_NODE'));
  const child = spawn(target.command, target.args, { cwd: target.cwd, env, detached: true, stdio: 'ignore' });
  child.on('error', (error) => {
    void log({ kind: 'relaunch-failed', error: error.message });
  });
  child.unref();
}

/** Main's messages in order; null once main has disconnected. */
const inbox: unknown[] = [];
let waiting: ((message: unknown) => void) | null = null;
let closed = false;
process.on('message', (message: unknown) => {
  if (waiting === null) inbox.push(message);
  else waiting(message);
  waiting = null;
});
process.on('disconnect', () => {
  closed = true;
  waiting?.(null);
  waiting = null;
});
const next = (): Promise<unknown> =>
  new Promise((resolve) => {
    if (inbox.length > 0) resolve(inbox.shift());
    else if (closed) resolve(null);
    else waiting = resolve;
  });
const send = (message: unknown): Promise<void> =>
  new Promise((resolve) => {
    if (process.send === undefined) resolve();
    else process.send(message, undefined, undefined, () => { resolve(); });
  });

if (process.send === undefined) await stop(2, { kind: 'refused', reason: 'Not started by Ori Kami.' });
const job = parseJobMessage(await next());
if (job === null) await stop(2, { kind: 'bad-job' });
else {
  const refusal = jobRefusal(job, { platform: process.platform, homeDir: await realpath(homedir()), execPath: process.execPath });
  if (refusal !== null) await stop(2, { kind: 'refused', reason: refusal });
  await send({ kind: 'ready' });
  if (!Commit.safeParse(await next()).success) {
    clearResetLock(job.context.profile.dataDir);
    await stop(0, { kind: 'cancelled' });
  }
  await send({ kind: 'committed' });
  if (process.connected) process.disconnect?.();
  const dataDir = job.context.profile.dataDir;
  try {
    const report = await runCleanup(job, { keychain: MAC_KEYCHAIN, isAlive, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), beat: () => { touchResetLock(dataDir); } });
    clearResetLock(dataDir);
    await log(report);
    if (report.kind !== 'timed-out' && job.choice.kind === 'reset') relaunch(job.choice.relaunch);
  } catch (error) {
    await log({ kind: 'failed', error: error instanceof Error ? error.message : String(error) });
  } finally {
    clearResetLock(dataDir);
  }
}
