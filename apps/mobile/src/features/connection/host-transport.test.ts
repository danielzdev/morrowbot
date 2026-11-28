import { Agent, PairingCodeResponse, SendMessageResponse, Thread, ThreadState, type EventServerFrame } from '@morrowbot/contracts';
import { afterEach, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { LinkStatus } from '../../lib/host-connection.ts';
import { claimPairing, probeHost } from './claim.ts';
import type { OpenSocket } from './event-stream.ts';
import { connectHost, type LiveTransport } from './host-transport.ts';
import { startRealHost, type RealHost } from './real-host.test-support.ts';
import type { HostProfile } from './saved-hosts.ts';

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

/** Real sockets to the real host; `drop` cuts the newest one the way a lost network does. */
function realSockets(): { readonly open: OpenSocket; readonly drop: () => void } {
  const sockets: WebSocket[] = [];
  return {
    open: (url, token, handlers) => {
      const ws = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
      sockets.push(ws);
      ws.on('open', handlers.onOpen);
      ws.on('message', (data: Buffer) => {
        handlers.onMessage(data.toString('utf8'));
      });
      ws.on('close', handlers.onClose);
      ws.on('error', () => undefined);
      return {
        send: (text) => {
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

interface Watched {
  readonly live: LiveTransport;
  readonly statuses: LinkStatus['kind'][];
  readonly frames: EventServerFrame[];
  readonly until: (match: (frame: EventServerFrame) => boolean) => Promise<void>;
  readonly online: () => Promise<void>;
}

function connect(profile: HostProfile, open: OpenSocket): Watched {
  const statuses: LinkStatus['kind'][] = [];
  const frames: EventServerFrame[] = [];
  const waiters: (() => void)[] = [];
  const notify = (): void => {
    for (const waiter of waiters.splice(0)) waiter();
  };
  const live = connectHost(
    profile,
    { fetch, openSocket: open, delayFor: () => 50, now: () => 0, report: () => undefined },
    (state) => {
      if (statuses.at(-1) !== state.status.kind) statuses.push(state.status.kind);
      notify();
    },
  );
  cleanup.push(live.close);
  live.transport.listen((frame) => {
    frames.push(frame);
    notify();
  });
  const until = async (match: (frame: EventServerFrame) => boolean): Promise<void> => {
    while (!frames.some(match)) await new Promise<void>((resolve) => waiters.push(resolve));
  };
  const online = async (): Promise<void> => {
    while (statuses.at(-1) !== 'online') await new Promise<void>((resolve) => waiters.push(resolve));
  };
  return { live, statuses, frames, until, online };
}

const finished = (generationId: string) => (frame: EventServerFrame) => frame.kind === 'generation.finished' && frame.generationId === generationId;

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

it('resumes a thread from its cursor after the socket drops, delivering each missed event once', async () => {
  const host = await startHost();
  const sockets = realSockets();
  const watched = connect(await pair(host), sockets.open);
  const unbroken = connect(await pair(host), realSockets().open);
  await Promise.all([watched.online(), unbroken.online()]);
  const thread = await echoThread(host);
  const state = await watched.live.transport.request({ method: 'GET', path: `/api/threads/${thread.id}/state`, reply: ThreadState });
  if (state.kind !== 'ok') throw new Error(state.kind);
  watched.live.transport.watchThread(thread.id, state.value.cursor);
  unbroken.live.transport.watchThread(thread.id, state.value.cursor);

  const first = await watched.live.transport.request({
    method: 'POST',
    path: `/api/threads/${thread.id}/messages`,
    reply: SendMessageResponse,
    body: { text: 'first' },
  });
  if (first.kind !== 'ok') throw new Error(first.kind);
  await watched.until(finished(first.value.generationId));

  sockets.drop();
  const second = SendMessageResponse.parse((await host.call('POST', `/api/threads/${thread.id}/messages`, { text: 'second' })).body);
  await Promise.all([watched.until(finished(second.generationId)), unbroken.until(finished(second.generationId))]);

  const seqs = watched.frames.flatMap((frame) => ('cursor' in frame ? [frame.cursor.seq] : []));
  const ofSecond = (frames: readonly EventServerFrame[]) =>
    frames.filter((frame) => 'generationId' in frame && frame.generationId === second.generationId).map((frame) => frame.kind);
  expect({
    statuses: watched.statuses,
    secondGeneration: ofSecond(watched.frames),
    sameAsUnbrokenSocket: JSON.stringify(ofSecond(watched.frames)) === JSON.stringify(ofSecond(unbroken.frames)),
    seqsStrictlyIncrease: seqs.every((seq, index) => index === 0 || seq > (seqs[index - 1] ?? Infinity)),
    firstSeqFollowsState: seqs[0] === state.value.cursor.seq + 1,
  }).toMatchInlineSnapshot(`
    {
      "firstSeqFollowsState": true,
      "sameAsUnbrokenSocket": true,
      "secondGeneration": [
        "generation.started",
        "generation.status",
        "generation.delta",
        "generation.delta",
        "generation.finished",
      ],
      "seqsStrictlyIncrease": true,
      "statuses": [
        "connecting",
        "online",
        "reconnecting",
        "connecting",
        "online",
      ],
    }
  `);
});

it('stops for good once the desktop unpairs the device', async () => {
  const host = await startHost();
  const profile = await pair(host);
  const watched = connect(profile, realSockets().open);
  await watched.online();
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
        "connecting",
        "online",
        "revoked",
      ],
      "unpaired": 204,
    }
  `);
});
