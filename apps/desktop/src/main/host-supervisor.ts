import { fork, type ChildProcess } from 'node:child_process';
import { HostLaunchMessage } from '@morrowbot/contracts';
import type { HostTarget } from './ipc-proxy.ts';

const STOP_GRACE_MS = 10_000;

export interface HostSupervisorEvents {
  /** The host is serving. `restarted` is true when this replaces a host that crashed. */
  ready(target: HostTarget, restarted: boolean): void;
  /** Another host holds this data directory. */
  alreadyRunning(): void;
  /** The host could not start, or crashed again after its one restart. */
  fatal(message: string): void;
}

export interface HostSupervisor {
  /** The running host, or undefined while it is starting, down or stopped. */
  target(): HostTarget | undefined;
  /** Disconnects the host (which stops it) and waits for it to exit. */
  stop(): Promise<void>;
}

type Launch =
  | { readonly kind: 'ready'; readonly target: HostTarget }
  | { readonly kind: 'already-running' }
  | { readonly kind: 'failed'; readonly message: string };

interface Launched {
  readonly child: ChildProcess;
  readonly first: Promise<Launch>;
  readonly exited: Promise<void>;
}

/** Forks the host under Electron-as-Node with an IPC channel and waits for its first message. */
function launch(hostMain: string): Launched {
  const child = fork(hostMain, [], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    execArgv: [],
  });
  const exited = new Promise<void>((resolve) => child.once('exit', () => { resolve(); }));
  const first = new Promise<Launch>((resolve) => {
    child.once('message', (message) => {
      const parsed = HostLaunchMessage.safeParse(message);
      if (parsed.success) {
        const launchMessage = parsed.data;
        switch (launchMessage.kind) {
          case 'ready':
            resolve({ kind: 'ready', target: { url: launchMessage.url, token: launchMessage.token } });
            return;
          case 'already-running':
          case 'failed':
            resolve(launchMessage);
            return;
        }
      }
      child.kill('SIGKILL');
      resolve({ kind: 'failed', message: 'The host sent an unexpected launch message' });
    });
    child.once('error', (error) => {
      resolve({ kind: 'failed', message: error.message });
    });
    child.once('exit', (code, signal) => {
      resolve({ kind: 'failed', message: `The host exited (${signal ?? String(code)}) before it was ready` });
    });
  });
  return { child, first, exited };
}

/** Starts the host and restarts it once, with a new token, if it exits unexpectedly. */
export function superviseHost(hostMain: string, events: HostSupervisorEvents): HostSupervisor {
  let current: Launched | undefined;
  let target: HostTarget | undefined;
  let restarted = false;
  let stopping = false;

  async function start(): Promise<void> {
    const launched = launch(hostMain);
    current = launched;
    const result = await launched.first;
    if (stopping) return;
    switch (result.kind) {
      case 'ready':
        target = result.target;
        void launched.exited.then(onExit);
        events.ready(result.target, restarted);
        return;
      case 'already-running':
        events.alreadyRunning();
        return;
      case 'failed':
        events.fatal(result.message);
        return;
    }
  }

  function onExit(): void {
    target = undefined;
    if (stopping) return;
    if (restarted) {
      events.fatal('The MorrowBot host stopped unexpectedly again.');
      return;
    }
    restarted = true;
    void start();
  }

  void start();
  return {
    target: () => target,
    stop: async () => {
      stopping = true;
      target = undefined;
      const launched = current;
      if (launched === undefined) return;
      const { child } = launched;
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (child.connected) child.disconnect();
      else child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), STOP_GRACE_MS);
      await launched.exited;
      clearTimeout(timer);
    },
  };
}
