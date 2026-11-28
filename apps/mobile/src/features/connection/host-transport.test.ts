import { Agent, EventClientFrame, PairingCodeResponse, SendMessageResponse, Thread, ThreadState } from '@morrowbot/contracts';
import { afterEach, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ThreadWatcher } from '../../lib/host-connection.ts';
import { claimPairing, probeHost } from './claim.ts';
import type { OpenSocket } from './event-stream.ts';
import type { HttpFetch } from './host-http.ts';
import { connectHost, type LiveTransport } from './host-transport.ts';
import { startRealHost, type RealHost } from './real-host.test-support.ts';
import type { HostProfile } from './saved-hosts.ts';

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

/**
 * Real sockets to the real host. `log` records each frame the app sends and each socket closing;
 * `drop` cuts the newest socket the way a lost network does.
 */
function realSockets(log: string[]): { readonly open: OpenSocket; readonly drop: () => void } {
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

/** `fetch`, noting each thread state request in `log`. */
function loggingFetch(log: string[]): HttpFetch {
  return async (url, init) => {
    if (url.endsWith('/state')) log.push('GET /state');
    return fetch(url, init);
  };
}

/** Notes in `log` what a screen watching the thread would be told. */
function recorder(log: string[]): ThreadWatcher {
  return {
    onFresh: (state) => log.push(`fresh: ${String(state.messages.length)} messages at seq ${String(state.cursor.seq)}`),
    onEvent: (event) => log.push(`event ${event.kind}`),
    onStale: () => log.push('stale'),
  };
}

async function until(check: () => boolean): Promise<void> {
  while (!check()) await new Promise((resolve) => setTimeout(resolve, 10));
}

async function startHost(): Promise<RealHost> {
  const host = await startRealHost();
  cleanup.push(host.close);
  return host;
}

async function newCode(host: RealHost): Promise<string> {
  return PairingCodeResponse.parse((await host.call('POST', '/api/pairing/codes', { url: host.url })).body).code;
}

async function pair(host: RealHost): Promise<HostProfile> {
  const claim = await claimPairing(fetch, { url: host.url, code: await newCode(host) }, 'iPhone');
  if (claim.kind !== 'claimed') throw new Error(`claim failed: ${claim.kind}`);
  return claim.profile;
}

/** A thread on an agent bound to the fixture `echo` provider. */
async function echoThread(host: RealHost): Promise<Thread> {
  const provider = { kind: 'bound', pluginId: 'echo', selection: { kind: 'default' }, access: 'read-only', vendorSettings: 'isolated' };
  const agent = Agent.parse((await host.call('POST', '/api/agents', { name: 'Helper', provider })).body);
  return Thread.parse((await host.call('POST', `/api/agents/${agent.id}/threads`, { title: 'Chat' })).body);
}

interface App {
  readonly live: LiveTransport;
  readonly statuses: string[];
}

/** The app's transport. Backoff waits a minute, so any quick reconnect here is one the app asked for. */
function connect(profile: HostProfile, open: OpenSocket, httpFetch: HttpFetch = fetch): App {
  const statuses: string[] = [];
  const live = connectHost(profile, { fetch: httpFetch, openSocket: open, delayFor: () => 60_000, now: () => 0, report: () => undefined }, (state) => {
    const label = state.status.kind === 'connecting' ? `connecting (attempt ${String(state.status.attempt)})` : state.status.kind;
    if (statuses.at(-1) !== label) statuses.push(label);
  });
  cleanup.push(live.close);
  return { live, statuses };
}

/** Sends `text` the way the desktop would, and waits for the host to finish the turn. */
async function sendFromDesktop(host: RealHost, threadId: string, text: string): Promise<void> {
  SendMessageResponse.parse((await host.call('POST', `/api/threads/${threadId}/messages`, { text })).body);
  const idle = async (): Promise<boolean> => ThreadState.parse((await host.call('GET', `/api/threads/${threadId}/state`)).body).activeTurn === null;
  while (!(await idle())) await new Promise((resolve) => setTimeout(resolve, 10));
}

/** A paired app watching a fresh echo thread that already holds one finished turn. */
async function watchingApp(host: RealHost): Promise<{ readonly app: App; readonly sockets: ReturnType<typeof realSockets>; readonly log: string[]; readonly threadId: string }> {
  const log: string[] = [];
  const sockets = realSockets(log);
  const app = connect(await pair(host), sockets.open, loggingFetch(log));
  await until(() => app.statuses.at(-1) === 'online');
  const thread = await echoThread(host);
  cleanup.push(app.live.transport.watchThread(thread.id, recorder(log)));
  await until(() => log.some((line) => line.startsWith('fresh')));
  await sendFromDesktop(host, thread.id, 'first');
  await until(() => log.includes('event generation.finished'));
  log.push('---');
  return { app, sockets, log, threadId: thread.id };
}

const freshCount = (log: readonly string[]): number => log.filter((line) => line.startsWith('fresh')).length;

it('refuses a wrong code, then pairs and reaches the host with the device token', async () => {
  const host = await startHost();
  const code = await newCode(host);
  const wrong = await claimPairing(fetch, { url: host.url, code: code === '000000' ? '111111' : '000000' }, 'iPhone');
  const claim = await claimPairing(fetch, { url: host.url, code }, 'iPhone');
  const reused = await claimPairing(fetch, { url: host.url, code }, 'iPhone');
  if (claim.kind !== 'claimed') throw new Error(claim.kind);
  const offline = await probeHost(fetch, { ...claim.profile, url: 'http://127.0.0.1:9' });
  expect({
    wrong: wrong.kind,
    claimed: { hostName: claim.profile.hostName.length > 0, url: claim.profile.url === host.url },
    reused: reused.kind,
    probe: await probeHost(fetch, claim.profile),
    offline,
  }).toMatchInlineSnapshot(`
    {
      "claimed": {
        "hostName": true,
        "url": true,
      },
      "offline": {
        "kind": "offline",
      },
      "probe": {
        "kind": "online",
      },
      "reused": "wrong-code",
      "wrong": "wrong-code",
    }
  `);
});

it('after the socket drops, marks the thread stale, and on reconnecting fetches its state before subscribing', async () => {
  const host = await startHost();
  const { app, sockets, log, threadId } = await watchingApp(host);
  sockets.drop();
  await until(() => app.statuses.at(-1) === 'reconnecting');
  await sendFromDesktop(host, threadId, 'while offline');
  app.live.wake();
  await until(() => freshCount(log) === 2);
  expect({ statuses: app.statuses, afterFirstTurn: log.slice(log.indexOf('---') + 1) }).toMatchInlineSnapshot(`
    {
      "afterFirstTurn": [
        "socket closed",
        "stale",
        "GET /state",
        "subscribe since 10",
        "fresh: 4 messages at seq 10",
      ],
      "statuses": [
        "connecting (attempt 0)",
        "online",
        "reconnecting",
        "connecting (attempt 1)",
        "online",
      ],
    }
  `);
});

it('closes the socket in the background and, back in the foreground, reconnects at once and refetches before subscribing', async () => {
  const host = await startHost();
  const { app, log, threadId } = await watchingApp(host);
  app.live.pause();
  await until(() => log.includes('socket closed'));
  await sendFromDesktop(host, threadId, 'while in the background');
  app.live.wake();
  await until(() => freshCount(log) === 2);
  expect({ statuses: app.statuses, afterFirstTurn: log.slice(log.indexOf('---') + 1) }).toMatchInlineSnapshot(`
    {
      "afterFirstTurn": [
        "stale",
        "socket closed",
        "GET /state",
        "subscribe since 10",
        "fresh: 4 messages at seq 10",
      ],
      "statuses": [
        "connecting (attempt 0)",
        "online",
        "paused",
        "connecting (attempt 0)",
        "online",
      ],
    }
  `);
});

it('stops for good once the desktop unpairs the device', async () => {
  const host = await startHost();
  const profile = await pair(host);
  const watched = connect(profile, realSockets([]).open);
  await until(() => watched.statuses.at(-1) === 'online');
  const unpaired = await host.call('DELETE', `/api/pairing/devices/${profile.deviceId}`);
  while (watched.statuses.at(-1) !== 'revoked') await new Promise((resolve) => setTimeout(resolve, 10));
  const after = await watched.live.transport.request({ method: 'GET', path: '/api/agents', reply: ThreadState });
  expect({ unpaired: unpaired.status, statuses: watched.statuses, after: after.kind, probe: await probeHost(fetch, profile) }).toMatchInlineSnapshot(`
    {
      "after": "unauthorized",
      "probe": {
        "kind": "revoked",
      },
      "statuses": [
        "connecting (attempt 0)",
        "online",
        "revoked",
      ],
      "unpaired": 204,
    }
  `);
});
