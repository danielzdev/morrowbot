import { fork } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Agent, EventClientFrame, HostLaunchMessage, PairingCodeResponse, Thread } from '@morrowbot/contracts';
import WebSocket from 'ws';
import { claimPairing } from './claim.ts';
import type { OpenSocket } from './event-stream.ts';
import type { HostProfile } from './saved-hosts.ts';

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
  const dataDir = await mkdtemp(path.join(tmpdir(), 'orikami-mobile-'));
  const child = fork(HOST_MAIN, [], {
    env: { ...process.env, ORIKAMI_DATA_DIR: dataDir, ORIKAMI_PLUGINS_DIR: FIXTURE_PLUGINS },
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

/**
 * Real sockets to the real host. `log` records each frame the app sends and each socket closing;
 * `drop` cuts the newest socket the way a lost network does.
 */
export function realSockets(log: string[]): { readonly open: OpenSocket; readonly drop: () => void } {
  const sockets: WebSocket[] = [];
  return {
    open: (url, token, handlers) => {
      const ws = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
      sockets.push(ws);
      ws.on('open', handlers.onOpen);
      ws.on('message', (data: Buffer) => {
        handlers.onMessage(data.toString('utf8'));
      });
      ws.on('close', (code: number) => {
        log.push('socket closed');
        handlers.onClose(code);
      });
      ws.on('error', () => undefined);
      return {
        send: (text) => {
          const frame = EventClientFrame.parse(JSON.parse(text));
          log.push(frame.kind === 'subscribe' ? `subscribe since ${String(frame.since?.seq ?? null)}` : 'unsubscribe');
          ws.send(text);
        },
        close: () => {
          ws.terminate();
        },
      };
    },
    drop: () => sockets.at(-1)?.terminate(),
  };
}

export async function until(check: () => boolean): Promise<void> {
  while (!check()) await new Promise((resolve) => setTimeout(resolve, 10));
}

export async function newCode(host: RealHost): Promise<string> {
  return PairingCodeResponse.parse((await host.call('POST', '/api/pairing/codes', { url: host.url })).body).code;
}

export async function pair(host: RealHost): Promise<HostProfile> {
  const claim = await claimPairing(fetch, { url: host.url, code: await newCode(host) }, 'iPhone');
  if (claim.kind !== 'claimed') throw new Error(`claim failed: ${claim.kind}`);
  return claim.profile;
}

/** A thread on an agent bound to the fixture `echo` provider. */
export async function echoThread(host: RealHost): Promise<Thread> {
  const provider = { kind: 'bound', pluginId: 'echo', selection: { kind: 'default' }, access: 'read-only', vendorSettings: 'isolated' };
  const agent = Agent.parse((await host.call('POST', '/api/agents', { name: 'Helper', provider })).body);
  return Thread.parse((await host.call('POST', `/api/agents/${agent.id}/threads`, { title: 'Chat' })).body);
}
