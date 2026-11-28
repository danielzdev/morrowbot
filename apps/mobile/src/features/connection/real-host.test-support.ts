import { fork } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HostLaunchMessage } from '@morrowbot/contracts';

const HOST_MAIN = path.join(import.meta.dirname, '../../../../host/src/main.ts');
/** The host's fixture plugins; `echo` is a provider that streams its reply. */
const FIXTURE_PLUGINS = path.join(import.meta.dirname, '../../../../host/src/features/plugins/fixtures');

export interface RealHost {
  readonly url: string;
  /** Calls the API as the desktop app does, with this launch's token. */
  readonly call: (method: string, route: string, body?: unknown) => Promise<{ readonly status: number; readonly body: unknown }>;
  readonly close: () => Promise<void>;
}

/** Starts the real host process on loopback with an empty data folder, the way the desktop app forks it. Closing the IPC channel stops it. */
export async function startRealHost(): Promise<RealHost> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'morrowbot-mobile-'));
  const child = fork(HOST_MAIN, [], {
    env: { ...process.env, MORROWBOT_DATA_DIR: dataDir, MORROWBOT_PLUGINS_DIR: FIXTURE_PLUGINS },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const exited = new Promise<void>((resolve) => child.once('exit', () => {
    resolve();
  }));
  const launch = await new Promise<HostLaunchMessage>((resolve, reject) => {
    child.once('message', (message) => {
      resolve(HostLaunchMessage.parse(message));
    });
    child.once('exit', (code) => {
      reject(new Error(`The host exited (${String(code)}) before it was ready`));
    });
  });
  if (launch.kind !== 'ready') throw new Error(`The host did not start: ${launch.kind}`);
  const { url, token } = launch;
  return {
    url,
    call: async (method, route, body) => {
      const response = await fetch(`${url}${route}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      const parsed: unknown = text === '' ? null : JSON.parse(text);
      return { status: response.status, body: parsed };
    },
    close: async () => {
      if (child.connected) child.disconnect();
      else child.kill('SIGTERM');
      await exited;
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
