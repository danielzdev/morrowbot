import { fork, type StdioOptions } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIRST_FILE_FD, GuardMessage } from './command-protocol.ts';

const GUARD_PATH = fileURLToPath(new URL('./command-guard.ts', import.meta.url));
const STOP_GRACE_MS = 1_000;
const DRAIN_MS = 250;
const STDERR_LIMIT = 4_000;

export interface CommandOptions {
  readonly args: readonly string[];
  readonly cwd: string;
  /** Written to the command's stdin, which is then closed. */
  readonly input: string;
  /**
   * Extra inputs the command reads as files, without them touching the disk or the
   * process list. Put `commandFilePath(index)` in `args` where the command expects a path.
   */
  readonly files: readonly string[];
  /** Aborting stops the command (or keeps it from starting): SIGTERM to all its processes, then SIGKILL if any are left a second later. */
  readonly signal: AbortSignal;
  /** Hears each line the command prints to stdout, without the line break. */
  readonly onLine: (line: string) => void;
}

export type CommandExit =
  | {
      readonly kind: 'exited';
      readonly code: number | null;
      readonly signal: string | null;
      /** The end of what the command printed to stderr. */
      readonly stderr: string;
    }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failed'; readonly message: string };

/** The path that reads `files[index]` inside the command. */
export function commandFilePath(index: number): string {
  return `/dev/fd/${String(FIRST_FILE_FD + index)}`;
}

const running = new Set<() => Promise<CommandExit>>();

/**
 * Runs a program (found on `PATH` unless given as a path) and settles when it has exited.
 * Never rejects. The program runs in its own process group: when it exits, whatever it
 * left running in that group is killed, and so is the whole group if the plugin process dies.
 */
export function runCommand(command: string, options: CommandOptions): Promise<CommandExit> {
  if (options.signal.aborted) return Promise.resolve({ kind: 'exited', code: null, signal: null, stderr: '' });
  let fileFds: number[] = [];
  let guard;
  try {
    fileFds = options.files.map(unlinkedFile);
    const stdio: StdioOptions = ['pipe', 'pipe', 'pipe', 'ipc', ...fileFds];
    guard = fork(GUARD_PATH, [String(options.files.length), command, ...options.args], {
      cwd: options.cwd,
      detached: true,
      execArgv: [],
      serialization: 'json',
      stdio,
    });
  } catch (error) {
    return Promise.resolve({ kind: 'failed', message: describe(error) });
  } finally {
    for (const fd of fileFds) closeSync(fd);
  }
  const exit = Promise.withResolvers<CommandExit>();
  const { pid, stdin, stdout, stderr } = guard;
  let settled = false;
  let report: GuardMessage | undefined;
  let lineError: unknown;
  let errorOutput = '';
  let partial = '';
  let escalation: NodeJS.Timeout | undefined;

  const signalAll = (signal: NodeJS.Signals): void => {
    if (settled || pid === undefined) return;
    try {
      process.kill(-pid, signal);
    } catch {
      guard.kill(signal);
    }
  };
  const terminate = (): void => {
    if (escalation !== undefined) return;
    signalAll('SIGTERM');
    escalation = setTimeout(() => {
      signalAll('SIGKILL');
    }, STOP_GRACE_MS);
  };
  const stop = (): Promise<CommandExit> => {
    terminate();
    return exit.promise;
  };
  const finish = (result: CommandExit): void => {
    if (settled) return;
    settled = true;
    clearTimeout(escalation);
    running.delete(stop);
    options.signal.removeEventListener('abort', terminate);
    exit.resolve(result);
  };
  const emit = (line: string): void => {
    if (lineError !== undefined) return;
    try {
      options.onLine(line.endsWith('\r') ? line.slice(0, -1) : line);
    } catch (error) {
      lineError = error;
      terminate();
    }
  };

  running.add(stop);
  guard.on('error', (error) => {
    if (pid === undefined) finish({ kind: 'failed', message: `Could not start in ${options.cwd}: ${error.message}` });
  });
  guard.on('message', (raw: unknown) => {
    const parsed = GuardMessage.safeParse(raw);
    if (parsed.success) report = parsed.data;
  });
  const complete = (code: number | null, signal: string | null): void => {
    if (partial !== '') emit(partial);
    partial = '';
    finish(outcome(report, lineError, { kind: 'exited', code, signal, stderr: errorOutput }));
  };
  guard.on('close', complete);
  guard.on('exit', (code, signal) => {
    setTimeout(() => {
      stdout?.destroy();
      stderr?.destroy();
      complete(code, signal);
    }, DRAIN_MS).unref();
  });
  stdout?.setEncoding('utf8');
  stdout?.on('data', (text: string) => {
    const lines = (partial + text).split('\n');
    partial = lines.pop() ?? '';
    for (const line of lines) emit(line);
  });
  stderr?.setEncoding('utf8');
  stderr?.on('data', (text: string) => {
    errorOutput = (errorOutput + text).slice(-STDERR_LIMIT);
  });
  stdin?.on('error', () => undefined);
  stdin?.end(options.input);
  options.signal.addEventListener('abort', terminate, { once: true });
  return exit.promise;
}

/** Stops every running command and waits until they have exited. */
export async function stopAllCommands(): Promise<void> {
  await Promise.all([...running].map((stop) => stop()));
}

function outcome(
  report: GuardMessage | undefined,
  lineError: unknown,
  guardExit: Extract<CommandExit, { kind: 'exited' }>,
): CommandExit {
  if (lineError !== undefined) return { kind: 'failed', message: `onLine threw: ${describe(lineError)}` };
  if (report === undefined) return guardExit;
  switch (report.kind) {
    case 'exit':
      return { ...guardExit, code: report.code, signal: report.signal };
    case 'spawn-error':
      return report.code === 'ENOENT' ? { kind: 'not-found' } : { kind: 'failed', message: report.message };
  }
}

/** A private file with `contents` that has no name on disk: only the returned descriptor reaches it. */
function unlinkedFile(contents: string): number {
  const dir = mkdtempSync(path.join(tmpdir(), 'morrowbot-'));
  const file = path.join(dir, 'input');
  try {
    const fd = openSync(file, 'wx+', 0o600);
    writeSync(fd, Buffer.from(contents), 0, Buffer.byteLength(contents), 0);
    return fd;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
