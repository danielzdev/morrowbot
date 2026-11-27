import { spawn } from 'node:child_process';

const STOP_GRACE_MS = 1_000;
const STDERR_LIMIT = 4_000;
const USE_PROCESS_GROUP = process.platform !== 'win32';

export interface CommandOptions {
  readonly args: readonly string[];
  readonly cwd: string;
  /** Written to the command's stdin, which is then closed. */
  readonly input: string;
  /** Aborting stops the command: SIGTERM to its process group, then SIGKILL if it is still running a second later. */
  readonly signal: AbortSignal;
  /** Hears each line the command prints to stdout, without the line break. */
  readonly onLine: (line: string) => void;
}

export type CommandExit =
  | {
      readonly kind: 'exited';
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
      /** The end of what the command printed to stderr. */
      readonly stderr: string;
    }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failed'; readonly message: string };

interface Running {
  readonly stop: () => Promise<CommandExit>;
  readonly kill: () => void;
}

const running = new Set<Running>();
let exitHookInstalled = false;

/**
 * Runs a program (found on `PATH` unless given as a path) and settles when it exits. Never rejects.
 * Commands still running when the plugin stops are stopped with it.
 */
export function runCommand(command: string, options: CommandOptions): Promise<CommandExit> {
  installExitHook();
  let child;
  try {
    child = spawn(command, options.args, {
      cwd: options.cwd,
      detached: USE_PROCESS_GROUP,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    return Promise.resolve({ kind: 'failed', message: describe(error) });
  }
  const exit = Promise.withResolvers<CommandExit>();
  const { pid } = child;
  let settled = false;
  let stderr = '';
  let partial = '';
  let escalation: NodeJS.Timeout | undefined;

  const signalAll = (signal: NodeJS.Signals): void => {
    if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (USE_PROCESS_GROUP) process.kill(-pid, signal);
      else child.kill(signal);
    } catch {
      return;
    }
  };
  const terminate = (): void => {
    if (escalation !== undefined) return;
    signalAll('SIGTERM');
    escalation = setTimeout(() => {
      signalAll('SIGKILL');
    }, STOP_GRACE_MS);
  };
  const entry: Running = {
    stop: () => {
      terminate();
      return exit.promise;
    },
    kill: () => {
      signalAll('SIGKILL');
    },
  };
  const finish = (result: CommandExit): void => {
    if (settled) return;
    settled = true;
    clearTimeout(escalation);
    running.delete(entry);
    options.signal.removeEventListener('abort', terminate);
    exit.resolve(result);
  };
  const emit = (line: string): void => {
    options.onLine(line.endsWith('\r') ? line.slice(0, -1) : line);
  };

  running.add(entry);
  child.on('error', (error) => {
    if (child.pid !== undefined) return;
    finish(isMissing(error) ? { kind: 'not-found' } : { kind: 'failed', message: error.message });
  });
  child.on('close', (code, signal) => {
    if (partial !== '') emit(partial);
    partial = '';
    finish({ kind: 'exited', code, signal, stderr });
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (text: string) => {
    const lines = (partial + text).split('\n');
    partial = lines.pop() ?? '';
    for (const line of lines) emit(line);
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (text: string) => {
    stderr = (stderr + text).slice(-STDERR_LIMIT);
  });
  child.stdin.on('error', () => undefined);
  child.stdin.end(options.input);

  if (options.signal.aborted) terminate();
  else options.signal.addEventListener('abort', terminate, { once: true });
  return exit.promise;
}

/** Stops every running command and waits until they have exited. */
export async function stopAllCommands(): Promise<void> {
  await Promise.all([...running].map((entry) => entry.stop()));
}

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', () => {
    for (const entry of running) entry.kill();
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissing(error: Error): boolean {
  return 'code' in error && error.code === 'ENOENT';
}
