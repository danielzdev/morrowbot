import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process';
import { FIRST_FILE_FD, OwnerMessage, type GuardMessage } from './command-protocol.ts';
import { readProcessStart } from './process-start.ts';

/**
 * Runs one command for `openCommand` as the leader of its own process group. It reports itself
 * first and starts the command only after its owner says `spawn`, so the host has registered the
 * group before anything runs. Only the guard signals its group:
 * - on `kill`, or when the owner pipe closes (the plugin process went away, even by SIGKILL):
 *   SIGTERM to the group, then a final SIGKILL a second later that ends the guard too;
 * - when the command exits: an immediate SIGKILL to the group, so leftovers die with it.
 */
const STOP_GRACE_MS = 1_000;
const [fileCount = '0', command = '', ...args] = process.argv.slice(2);
const files = Array.from({ length: Number(fileCount) }, (_, index) => FIRST_FILE_FD + index);
const stdio: StdioOptions = ['inherit', 'inherit', 'inherit', 'ignore', ...files];
let child: ChildProcess | undefined;
let stopping = false;

function sweep(): void {
  try {
    process.kill(0, 'SIGKILL');
  } catch {
    child?.kill('SIGKILL');
    process.exit(1);
  }
}

function stop(): void {
  if (child === undefined) sweep();
  if (stopping) return;
  stopping = true;
  try {
    process.kill(0, 'SIGTERM');
  } catch {
    child?.kill('SIGTERM');
  }
  setTimeout(sweep, STOP_GRACE_MS);
}

function report(message: GuardMessage, done: () => void): void {
  try {
    if (process.send === undefined || !process.connected) done();
    else process.send(message, undefined, undefined, done);
  } catch {
    done();
  }
}

function start(own: Readonly<Record<string, string>>): void {
  if (child !== undefined || stopping) return;
  const env = { ...process.env, ...own };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    child = spawn(command, args, { stdio, env });
    child.on('error', (error) => {
      report({ kind: 'spawn-error', code: 'code' in error ? String(error.code) : '', message: error.message }, sweep);
    });
    child.on('exit', (code, signal) => {
      report({ kind: 'exit', code, signal }, sweep);
    });
  } catch (error) {
    report({ kind: 'spawn-error', code: '', message: error instanceof Error ? error.message : String(error) }, sweep);
  }
}

process.on('SIGTERM', () => undefined);
process.on('disconnect', stop);
process.on('message', (raw: unknown) => {
  const parsed = OwnerMessage.safeParse(raw);
  if (!parsed.success) return;
  switch (parsed.data.kind) {
    case 'spawn':
      start(parsed.data.env);
      return;
    case 'kill':
      stop();
      return;
  }
});
report({ kind: 'started', pgid: process.pid, leaderStart: readProcessStart(process.pid) ?? 'unreadable' }, () => {
  if (process.send === undefined || !process.connected) stop();
});
