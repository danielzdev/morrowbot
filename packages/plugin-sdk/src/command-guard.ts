import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process';
import { FIRST_FILE_FD, type GuardMessage } from './command-protocol.ts';

/**
 * Runs one command for `runCommand` as the leader of its own process group, so the
 * whole group is killed when the command exits, or when the plugin process goes away
 * for any reason, including SIGKILL.
 */
const [fileCount = '0', command = '', ...args] = process.argv.slice(2);
const files = Array.from({ length: Number(fileCount) }, (_, index) => FIRST_FILE_FD + index);
const stdio: StdioOptions = ['inherit', 'inherit', 'inherit', 'ignore', ...files];
let child: ChildProcess | undefined;

function sweep(): void {
  try {
    process.kill(0, 'SIGKILL');
  } catch {
    child?.kill('SIGKILL');
    process.exit(1);
  }
}

function report(message: GuardMessage): void {
  if (process.send === undefined) sweep();
  else process.send(message, undefined, undefined, sweep);
}

process.on('SIGTERM', () => undefined);
process.on('disconnect', sweep);
try {
  child = spawn(command, args, { stdio });
  child.on('error', (error) => {
    report({ kind: 'spawn-error', code: 'code' in error ? String(error.code) : '', message: error.message });
  });
  child.on('exit', (code, signal) => {
    report({ kind: 'exit', code, signal });
  });
} catch (error) {
  report({ kind: 'spawn-error', code: '', message: error instanceof Error ? error.message : String(error) });
}
