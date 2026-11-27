import { fork, type StdioOptions } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChildGroupScope } from '@morrowbot/contracts';
import { FIRST_FILE_FD, GuardMessage, type OwnerMessage } from './command-protocol.ts';
import type { GroupLink } from './host-link.ts';

const GUARD_PATH = fileURLToPath(new URL('./command-guard.ts', import.meta.url));
const DRAIN_MS = 250;
const STDERR_LIMIT = 4_000;
/** The longest stdout line a command may print; a longer one stops it, so one runaway line cannot exhaust the process that reads it. */
export const LINE_LIMIT = 64 * 1024 * 1024;

export interface CommandOptions {
  readonly args: readonly string[];
  readonly cwd: string;
  /**
   * Extra inputs the command reads as files, kept out of the process list. Each goes in a
   * private (0600) temporary file whose name is removed before its contents are written, so
   * only the command's file descriptor reaches it. Put `commandFilePath(index)` in `args`
   * where the command expects a path.
   */
  readonly files: readonly string[];
  /**
   * What the command's process group belongs to: a turn (by its `turnId`), a short probe, or the
   * plugin's shared daemon (started from `providerInfo`, kept across turns, stopped by the host's
   * `kill-child-group` or when the plugin shuts down).
   */
  readonly scope: ChildGroupScope;
  /** Aborting stops the command (or keeps it from starting): its guard sends SIGTERM to the group, then SIGKILL a second later. */
  readonly signal: AbortSignal;
  /** Hears each line the command prints to stdout, without the line break. */
  readonly onLine: (line: string) => void;
}

export interface RunCommandOptions extends CommandOptions {
  /** Written to the command's stdin, which is then closed. */
  readonly input: string;
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

/** A started command whose stdin stays open until `end`. */
export interface OpenCommand {
  /** Settles once the command and its guard have exited. Never rejects. */
  readonly exited: Promise<CommandExit>;
  write(text: string): void;
  end(): void;
}

/** The path that reads `files[index]` inside the command. */
export function commandFilePath(index: number): string {
  return `/dev/fd/${String(FIRST_FILE_FD + index)}`;
}

/** How one plugin starts commands. Each plugin (a worker process, or a built-in provider in the host) has its own. */
export interface CommandRunner {
  readonly open: (command: string, options: CommandOptions) => OpenCommand;
  /** The one-shot form of `open`: writes `input` to stdin, closes it, and waits for the exit. */
  readonly run: (command: string, options: RunCommandOptions) => Promise<CommandExit>;
  /** Stops every running command and waits until they have exited. */
  readonly stopAll: () => Promise<void>;
  /** Stops the commands a turn started and waits until they have exited, so no turn group outlives its turn. */
  readonly stopTurn: (turnId: string) => Promise<void>;
  /**
   * The owner is gone or has shut down (a worker would now exit): every guard's owner pipe is
   * closed, so each sweeps its group as it would on a worker's SIGKILL, and no command starts again.
   */
  readonly abandon: () => void;
}

interface Running {
  readonly stop: () => Promise<CommandExit>;
  readonly scope: ChildGroupScope;
  readonly abandon: () => void;
}

/** `env` is what every guard and its command run with; `link` registers each group with the host before the command starts. */
export function createCommandRunner(link: GroupLink, env: Readonly<Record<string, string | undefined>>): CommandRunner {
  const running = new Set<Running>();
  let abandoned = false;
  const open = (command: string, options: CommandOptions): OpenCommand => {
    if (abandoned) return closedCommand({ kind: 'failed', message: 'The plugin has stopped' });
    return openCommand(command, options, { link, env, running });
  };
  return {
    open,
    run: (command, options) => {
      const opened = open(command, options);
      opened.write(options.input);
      opened.end();
      return opened.exited;
    },
    stopAll: async () => {
      await Promise.all([...running].map(({ stop }) => stop()));
    },
    stopTurn: async (turnId) => {
      const owned = [...running].filter(({ scope }) => scope.kind === 'turn' && scope.turnId === turnId);
      await Promise.all(owned.map(({ stop }) => stop()));
    },
    abandon: () => {
      abandoned = true;
      for (const command of running) command.abandon();
    },
  };
}

interface Owner {
  readonly link: GroupLink;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly running: Set<Running>;
}

/**
 * Starts a program (found on `PATH` unless given as a path) through a guard process that leads its
 * own process group. The guard reports the group to the host and waits for the host's
 * acknowledgement before it starts the program. When the program exits, whatever it left running
 * in the group is killed; the whole group is killed if the owner goes away. macOS and Linux only.
 */
function openCommand(command: string, options: CommandOptions, owner: Owner): OpenCommand {
  if (options.signal.aborted) return closedCommand({ kind: 'exited', code: null, signal: null, stderr: '' });
  const fileFds: number[] = [];
  let guard;
  try {
    for (const contents of options.files) fileFds.push(unlinkedFile(contents));
    const stdio: StdioOptions = ['pipe', 'pipe', 'pipe', 'ipc', ...fileFds];
    guard = fork(GUARD_PATH, [String(options.files.length), command, ...options.args], {
      cwd: options.cwd,
      detached: true,
      env: guardEnv(owner.env),
      execArgv: [],
      serialization: 'json',
      stdio,
    });
  } catch (error) {
    return closedCommand({ kind: 'failed', message: describe(error) });
  } finally {
    for (const fd of fileFds) closeSync(fd);
  }
  const exit = Promise.withResolvers<CommandExit>();
  const { stdin, stdout, stderr } = guard;
  let settled = false;
  let killed = false;
  let pgid: number | undefined;
  let report: GuardMessage | undefined;
  /** Why the command was stopped while its output was read: `onLine` threw, or a line ran past `LINE_LIMIT`. */
  let lineError: string | undefined;
  let errorOutput = '';
  let partial: string[] = [];
  let partialLength = 0;

  const tell = (message: OwnerMessage): void => {
    if (!guard.connected) return;
    try {
      guard.send(message, (error) => {
        if (error) guard.disconnect();
      });
    } catch {
      guard.disconnect();
    }
  };
  const terminate = (): void => {
    if (killed || settled) return;
    killed = true;
    tell({ kind: 'kill' });
  };
  const stop = (): Promise<CommandExit> => {
    terminate();
    return exit.promise;
  };
  const entry: Running = {
    stop,
    scope: options.scope,
    abandon: () => {
      if (guard.connected) guard.disconnect();
    },
  };
  const finish = (result: CommandExit): void => {
    if (settled) return;
    settled = true;
    owner.running.delete(entry);
    options.signal.removeEventListener('abort', terminate);
    if (pgid !== undefined) owner.link.exited(pgid);
    exit.resolve(result);
  };
  const emit = (line: string): void => {
    if (lineError !== undefined) return;
    try {
      options.onLine(line.endsWith('\r') ? line.slice(0, -1) : line);
    } catch (error) {
      lineError = `onLine threw: ${describe(error)}`;
      terminate();
    }
  };

  owner.running.add(entry);
  guard.on('error', (error) => {
    if (guard.pid === undefined) finish({ kind: 'failed', message: `Could not start in ${options.cwd}: ${error.message}` });
  });
  guard.on('message', (raw: unknown) => {
    const parsed = GuardMessage.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.kind !== 'started') {
      report = message;
      return;
    }
    if (pgid !== undefined) return;
    pgid = message.pgid;
    void owner.link.register(message.pgid, message.leaderStart, options.scope, terminate).then(() => {
      if (!killed) tell({ kind: 'spawn' });
    });
  });
  const complete = (code: number | null, signal: string | null): void => {
    if (partialLength > 0) emit(partial.join(''));
    partial = [];
    partialLength = 0;
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
    if (lineError !== undefined) return;
    const lines = text.split('\n');
    const rest = lines.pop() ?? '';
    for (const line of lines) {
      partial.push(line);
      emit(partial.join(''));
      partial = [];
      partialLength = 0;
    }
    partial.push(rest);
    partialLength += rest.length;
    if (partialLength > LINE_LIMIT) {
      partial = [];
      partialLength = 0;
      lineError = `The command printed a line longer than ${String(LINE_LIMIT)} characters`;
      terminate();
    }
  });
  stderr?.setEncoding('utf8');
  stderr?.on('data', (text: string) => {
    errorOutput = (errorOutput + text).slice(-STDERR_LIMIT);
  });
  stdin?.on('error', () => undefined);
  options.signal.addEventListener('abort', terminate, { once: true });
  return {
    exited: exit.promise,
    write: (text) => {
      if (stdin?.writable === true) stdin.write(text);
    },
    end: () => {
      stdin?.end();
    },
  };
}

/** Under Electron the guard runs on the Electron binary, which must act as plain Node. The guard removes it again for the command. */
function guardEnv(env: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  return process.versions.electron === undefined ? { ...env } : { ...env, ELECTRON_RUN_AS_NODE: '1' };
}

function closedCommand(result: CommandExit): OpenCommand {
  return { exited: Promise.resolve(result), write: () => undefined, end: () => undefined };
}

function outcome(
  report: GuardMessage | undefined,
  lineError: string | undefined,
  guardExit: Extract<CommandExit, { kind: 'exited' }>,
): CommandExit {
  if (lineError !== undefined) return { kind: 'failed', message: lineError };
  if (report === undefined) return guardExit;
  switch (report.kind) {
    case 'started':
      return guardExit;
    case 'exit':
      return { ...guardExit, code: report.code, signal: report.signal };
    case 'spawn-error':
      return report.code === 'ENOENT' ? { kind: 'not-found' } : { kind: 'failed', message: report.message };
  }
}

/** A private file with `contents` that has no name on disk: only the returned descriptor reaches it. */
function unlinkedFile(contents: string): number {
  const dir = mkdtempSync(path.join(tmpdir(), 'morrowbot-'));
  let fd: number;
  try {
    fd = openSync(path.join(dir, 'input'), 'wx+', 0o600);
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  try {
    rmSync(dir, { recursive: true, force: true });
    const bytes = Buffer.from(contents);
    for (let written = 0; written < bytes.length; ) {
      const count = writeSync(fd, bytes, written, bytes.length - written, written);
      if (count === 0) throw new Error('Could not write a command input file');
      written += count;
    }
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
