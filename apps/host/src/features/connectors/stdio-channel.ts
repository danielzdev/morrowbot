import { spawn, type ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import { abortFailure, McpFailure, type McpChannel } from './channel.ts';
import { answerServer, parseMessages, rpcFailure } from './json-rpc.ts';

/** The longest line a local server may print; a longer one stops it. */
const LINE_LIMIT = 16 * 1024 * 1024;
/** How long a stopped server gets after SIGTERM before its whole group is killed. */
const STOP_GRACE_MS = 2_000;
/** Only these of the host's variables reach a local server; the user's own come on top. */
const PASSED_ENV = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TZ'];

export interface StdioOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  /** The `PATH` the command is found on (the user's login-shell PATH). */
  readonly path: string;
}

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (failure: McpFailure) => void;
}

/**
 * Starts a local MCP server as the leader of its own process group, speaking newline-delimited
 * JSON-RPC on stdin/stdout. Its stderr is dropped unread, so nothing it prints can carry a secret into
 * a log. `close` (and the end of the server) stops the whole group: SIGTERM, then SIGKILL.
 */
export function openStdioChannel(options: StdioOptions): McpChannel {
  const env: Record<string, string> = { PATH: options.path };
  for (const name of PASSED_ENV) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  Object.assign(env, options.env);
  let child: ChildProcess;
  try {
    child = spawn(options.command, [...options.args], { cwd: homedir(), env, detached: true, stdio: ['pipe', 'pipe', 'ignore'] });
  } catch {
    return failedChannel(new McpFailure('exited', 'The command could not start; check its path, arguments and variables'));
  }
  const pending = new Map<number, Pending>();
  const endListeners: ((failure: McpFailure) => void)[] = [];
  let nextId = 1;
  let ended: McpFailure | undefined;
  let closing = false;
  let buffer = '';

  const end = (failure: McpFailure): void => {
    if (ended !== undefined) return;
    ended = failure;
    for (const each of pending.values()) each.reject(failure);
    pending.clear();
    killGroup(child, 'SIGTERM');
    setTimeout(() => {
      killGroup(child, 'SIGKILL');
    }, STOP_GRACE_MS).unref();
    if (!closing) for (const listener of endListeners) listener(failure);
  };
  const write = (message: object): void => {
    if (ended !== undefined || child.stdin === null || !child.stdin.writable) return;
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const receive = (line: string): void => {
    for (const message of parseMessages(line)) {
      switch (message.kind) {
        case 'result':
        case 'error': {
          const id = typeof message.id === 'number' ? message.id : Number.NaN;
          const waiting = pending.get(id);
          if (waiting === undefined) break;
          pending.delete(id);
          if (message.kind === 'result') waiting.resolve(message.result);
          else waiting.reject(rpcFailure(message.error));
          break;
        }
        case 'request':
          write(answerServer(message.id, message.method));
          break;
        case 'notification':
          break;
      }
    }
  };

  child.stdin?.on('error', () => undefined);
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line !== '') receive(line);
      newline = buffer.indexOf('\n');
    }
    if (buffer.length > LINE_LIMIT) end(new McpFailure('protocol', 'The server printed a line too long to read'));
  });
  child.on('error', (error: NodeJS.ErrnoException) => {
    end(new McpFailure('exited', error.code === 'ENOENT' ? `Command not found: ${options.command}` : `The command could not start (${error.code ?? 'error'})`));
  });
  child.on('exit', (code, signal) => {
    end(new McpFailure('exited', signal === null ? `The server exited (code ${String(code)})` : `The server was stopped (${signal})`));
  });

  return {
    request: (method, params, signal) => {
      if (ended !== undefined) return Promise.reject(ended);
      if (signal.aborted) return Promise.reject(abortFailure(signal, method));
      const id = nextId++;
      return new Promise<unknown>((resolve, reject) => {
        const onAbort = (): void => {
          if (!pending.delete(id)) return;
          write({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'The turn ended' } });
          reject(abortFailure(signal, method));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        pending.set(id, {
          resolve: (value) => {
            signal.removeEventListener('abort', onAbort);
            resolve(value);
          },
          reject: (failure) => {
            signal.removeEventListener('abort', onAbort);
            reject(failure);
          },
        });
        write({ jsonrpc: '2.0', id, method, params });
      });
    },
    notify: (method, params) => {
      write({ jsonrpc: '2.0', method, params });
      return Promise.resolve();
    },
    onEnd: (listener) => {
      endListeners.push(listener);
    },
    setProtocolVersion: () => undefined,
    close: async () => {
      closing = true;
      const exited = child.exitCode !== null || child.signalCode !== null;
      child.stdin?.end();
      end(new McpFailure('aborted', 'The connector was disconnected'));
      if (exited) {
        if (groupAlive(child)) await new Promise((resolve) => setTimeout(resolve, STOP_GRACE_MS));
        killGroup(child, 'SIGKILL');
        return;
      }
      await new Promise<void>((resolve) => {
        const kill = setTimeout(() => {
          killGroup(child, 'SIGKILL');
          resolve();
        }, STOP_GRACE_MS);
        child.once('exit', () => {
          clearTimeout(kill);
          killGroup(child, 'SIGKILL');
          resolve();
        });
      });
    },
  };
}

/** Whether anything is left in the server's process group. */
function groupAlive(child: ChildProcess): boolean {
  if (child.pid === undefined) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A channel whose server never started: every request fails with why. */
function failedChannel(failure: McpFailure): McpChannel {
  return {
    request: () => Promise.reject(failure),
    notify: () => Promise.resolve(),
    onEnd: () => undefined,
    setProtocolVersion: () => undefined,
    close: () => Promise.resolve(),
  };
}

/** Signals the server's whole process group, so whatever it started stops with it. */
function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    return;
  }
}
