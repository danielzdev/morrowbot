import { spawn } from 'node:child_process';

/** How a helper program ended: its exit code and output, or `missing` when it is not installed. */
export type RunResult =
  | { readonly kind: 'exited'; readonly code: number | null; readonly stdout: string; readonly stderr: string }
  | { readonly kind: 'missing' };

/** Runs a program with `input` on stdin. Secrets travel only on stdin and stdout, never in arguments. */
export type Run = (command: string, args: readonly string[], input: string) => Promise<RunResult>;

const TIMEOUT_MS = 15_000;

export const runProgram: Run = (command, args, input) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], timeout: TIMEOUT_MS, windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', () => {
      resolve({ kind: 'missing' });
    });
    child.once('close', (code) => {
      resolve({ kind: 'exited', code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
