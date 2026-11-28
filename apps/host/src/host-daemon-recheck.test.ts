import { ApiError, PluginList, ProviderInfoResponse, StartedSend } from '@morrowbot/contracts';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_PLUGIN_TIMEOUTS } from './features/plugins/index.ts';
import type { Reply } from './testing/test-host.ts';
import { startDaemonFixture, stickyProbe, until, type DaemonFixture } from './testing/daemon-fixture.ts';

let chat: DaemonFixture | undefined;
afterEach(async () => {
  await chat?.close();
  chat = undefined;
});

/** A reply as `status kind` plus the info kind (and the daemon that answered) or error kind/reason. */
function brief(reply: Reply): string {
  const info = ProviderInfoResponse.safeParse(reply.body);
  if (info.success) {
    const shown = info.data.info;
    return `${String(reply.status)} ${shown.kind}${shown.kind === 'ready' ? ` ${shown.accountLabel ?? ''}` : ''}`;
  }
  const error = ApiError.safeParse(reply.body);
  if (!error.success) return String(reply.status);
  const detail = 'reason' in error.data.error ? error.data.error.reason : error.data.error.message;
  return `${String(reply.status)} ${error.data.error.kind}: ${detail}`;
}

const recheck = (fixture: DaemonFixture) => fixture.host.call('POST', '/api/plugins/daemon/recheck');
const post = (fixture: DaemonFixture, threadId: string, text: string) => fixture.host.call('POST', `/api/threads/${threadId}/messages`, { text });

it('Recheck supersedes a paused cold start: its answer is discarded, its send gets binding-changed, and only the fresh daemon publishes', async () => {
  chat = await startDaemonFixture();
  const fixture = chat;
  const agent = await fixture.agent();
  const [cold, other] = [await fixture.thread(agent, 'A'), await fixture.thread(agent, 'B')];
  await fixture.setFlag('pause-info', true);
  const coldSend = post(fixture, cold.id, 'hello');
  await until(async () => (await fixture.daemonEvents()).includes('info false d1'));
  const before = fixture.host.host.plugins.revision('daemon').daemonRevision;
  const rechecking = recheck(fixture);
  await until(() => fixture.host.host.plugins.revision('daemon').daemonRevision > before);
  const during = {
    send: brief(await post(fixture, other.id, 'meanwhile')),
    info: brief(await fixture.host.call('GET', '/api/plugins/daemon/info')),
    recheck: brief(await recheck(fixture)),
  };
  await fixture.setFlag('pause-info', false);
  const [coldReply, recheckReply] = await Promise.all([coldSend, rechecking]);
  const cached = brief(await fixture.host.call('GET', '/api/plugins/daemon/info'));
  await fixture.send(other, 'after');
  expect({
    during,
    cold: brief(coldReply),
    recheck: brief(recheckReply),
    cached,
    signals: await fixture.signals(),
    events: await fixture.daemonEvents(),
    histories: [await fixture.history(cold), await fixture.history(other)],
  }).toMatchInlineSnapshot(`
    {
      "cached": "200 ready d2",
      "cold": "409 binding-changed: The agent's provider settings changed while sending. Nothing was sent; try again.",
      "during": {
        "info": "409 conflict: The provider is being rechecked. Try again in a moment.",
        "recheck": "409 conflict: This provider is already being rechecked.",
        "send": "503 provider-unavailable: rechecking",
      },
      "events": [
        "daemon-start d1",
        "info false d1",
        "daemon-exit d1",
        "daemon-start d2",
        "info true d2",
        "turn d2 after",
      ],
      "histories": [
        [],
        [
          "user: after",
          "assistant(completed): d2: after",
        ],
      ],
      "recheck": "200 ready d2",
      "signals": [
        "d1 SIGTERM",
      ],
    }
  `);
});

it('Recheck is refused while a turn is running or queued; once idle it retires the daemon cleanly and starts one fresh daemon', async () => {
  chat = await startDaemonFixture();
  const fixture = chat;
  const agent = await fixture.agent();
  const threads = [await fixture.thread(agent, 'A'), await fixture.thread(agent, 'B'), await fixture.thread(agent, 'C')];
  for (const thread of threads) StartedSend.parse((await post(fixture, thread.id, 'stall')).body);
  await until(async () => (await fixture.daemonEvents()).filter((line) => line.startsWith('turn')).length === 2);
  const busy = brief(await recheck(fixture));
  for (const thread of threads) await fixture.host.call('POST', `/api/threads/${thread.id}/stop`);
  const idle = brief(await recheck(fixture));
  await fixture.send(threads[0] ?? fail(), 'after');
  expect({ busy, idle, signals: await fixture.signals(), rows: fixture.daemonRows(), events: await fixture.daemonEvents() }).toMatchInlineSnapshot(`
    {
      "busy": "409 conflict: Stop the turns using this provider before rechecking it.",
      "events": [
        "daemon-start d1",
        "info false d1",
        "turn d1 stall",
        "turn d1 stall",
        "turn d1 stall",
        "daemon-exit d1",
        "daemon-start d2",
        "info true d2",
        "turn d2 after",
      ],
      "idle": "200 ready d2",
      "rows": [
        {
          "generationIds": [],
          "state": "live",
        },
      ],
      "signals": [
        "d1 SIGTERM",
      ],
    }
  `);
});

it('Recheck whose daemon will not exit quarantines with admission closed; a second Recheck is refused without signalling; the release reopens it', async () => {
  const sticky = stickyProbe();
  let holding = true;
  chat = await startDaemonFixture({ probe: sticky.probe });
  const fixture = chat;
  const thread = await fixture.thread(await fixture.agent());
  await fixture.send(thread, 'hello');
  sticky.stick(fixture.daemonPgid(), () => holding);
  const first = brief(await recheck(fixture));
  const entry = PluginList.parse((await fixture.host.call('GET', '/api/plugins')).body).plugins.find(({ manifest }) => manifest.id === 'daemon');
  const send = brief(await post(fixture, thread.id, 'blocked'));
  const revision = () => fixture.host.host.plugins.revision('daemon').daemonRevision;
  const beforeSecond = revision();
  const second = brief(await recheck(fixture));
  const secondMovedRevision = revision() !== beforeSecond;
  const signals = await fixture.signals();
  holding = false;
  await until(() => fixture.daemonRows().length === 0);
  await until(async () => (await fixture.host.call('POST', `/api/threads/${thread.id}/messages`, { text: 'after' })).status === 202);
  expect({
    first: first.replace(/group \d+/, 'group PGID'),
    status: entry?.status.kind,
    blocked: entry?.blockedGroups.map((group) => group.kind),
    send,
    second: second.replace(/group \d+/, 'group PGID'),
    secondMovedRevision,
    signals,
    probe: sticky.seen,
  }).toMatchInlineSnapshot(`
    {
      "blocked": [
        "daemon",
      ],
      "first": "409 conflict: Cleanup failed: process group PGID is still running",
      "probe": [
        "alive",
        "gone",
      ],
      "second": "409 conflict: Cleanup failed: process group PGID is still running",
      "secondMovedRevision": false,
      "send": "503 provider-unavailable: daemon-blocked",
      "signals": [
        "d1 SIGTERM",
      ],
      "status": "quarantined",
    }
  `);
});

it('Recheck supersedes an in-flight route-info and usage request: the send gets binding-changed, not route-info-failed, and the usage answer is discarded', async () => {
  chat = await startDaemonFixture();
  const fixture = chat;
  await fixture.setFlag('sessions', true);
  const thread = await fixture.thread(await fixture.agent());
  await fixture.send(thread, 'hello');
  await fixture.setFlag('pause-route', true);
  await fixture.setFlag('pause-usage', true);
  const send = post(fixture, thread.id, 'routed');
  const usage = fixture.host.call('GET', '/api/plugins/daemon/usage');
  await until(async () => {
    const events = await fixture.daemonEvents();
    return events.filter((line) => line === 'route d1').length === 2 && events.includes('usage d1');
  });
  const rechecked = brief(await recheck(fixture));
  await fixture.setFlag('pause-route', false);
  await fixture.setFlag('pause-usage', false);
  const [sent, used] = await Promise.all([send, usage]);
  expect({ rechecked, send: brief(sent), usage: brief(used), events: await fixture.daemonEvents(), history: await fixture.history(thread) }).toMatchInlineSnapshot(`
    {
      "events": [
        "daemon-start d1",
        "info false d1",
        "route d1",
        "turn d1 hello",
        "usage d1",
        "route d1",
        "daemon-exit d1",
        "daemon-start d2",
        "info true d2",
      ],
      "history": [
        "user: hello",
        "assistant(completed): d1: hello",
      ],
      "rechecked": "200 ready d2",
      "send": "409 binding-changed: The agent's provider settings changed while sending. Nothing was sent; try again.",
      "usage": "409 conflict: The provider was rechecked meanwhile. Try again.",
    }
  `);
});

/** The fresh start's deadline also covers spawning its daemon, so it must outlast a spawn on a loaded machine and expire only in the hung info call. */
const FRESH_START_DEADLINE_MS = 5_000;

it('Recheck whose fresh start times out cancels it with its worker, verifies its exit, records an info error and reopens admission', async () => {
  chat = await startDaemonFixture({ timeouts: { ...DEFAULT_PLUGIN_TIMEOUTS, infoMs: FRESH_START_DEADLINE_MS } });
  const fixture = chat;
  const thread = await fixture.thread(await fixture.agent());
  await fixture.send(thread, 'hello');
  await fixture.setFlag('hang-info', true);
  const timedOut = await recheck(fixture);
  const rowsAfter = fixture.daemonRows();
  const info = brief(await fixture.host.call('GET', '/api/plugins/daemon/info'));
  const send = brief(await post(fixture, thread.id, 'gated'));
  await fixture.setFlag('hang-info', false);
  const refreshed = brief(await fixture.host.call('GET', '/api/plugins/daemon/info?refresh=1'));
  await fixture.send(thread, 'after');
  /** A loaded machine can hit the 500 ms deadline before the hung daemon logs the request it was sent (#61). */
  const events = (await fixture.daemonEvents()).filter((event) => event !== 'info true d2');
  expect({ timedOut: timedOut.body, rowsAfter, info, send, refreshed, events }).toMatchInlineSnapshot(`
    {
      "events": [
        "daemon-start d1",
        "info false d1",
        "turn d1 hello",
        "daemon-exit d1",
        "daemon-start d2",
        "daemon-start d3",
        "info true d3",
        "turn d3 after",
      ],
      "info": "200 error",
      "refreshed": "200 ready d3",
      "rowsAfter": [],
      "send": "409 conflict: The provider could not be checked: The provider did not finish starting in time. Recheck to try again.",
      "timedOut": {
        "info": {
          "kind": "error",
          "message": "The provider did not finish starting in time. Recheck to try again.",
        },
      },
    }
  `);
});

it('Recheck that finds the provider signed out still reopens admission; sends then gate on that info', async () => {
  chat = await startDaemonFixture();
  const fixture = chat;
  const thread = await fixture.thread(await fixture.agent());
  await fixture.send(thread, 'hello');
  await fixture.setFlag('signed-out', true);
  const signedOut = brief(await recheck(fixture));
  const gated = (await post(fixture, thread.id, 'gated')).body;
  await fixture.setFlag('signed-out', false);
  const again = brief(await recheck(fixture));
  await fixture.send(thread, 'after');
  expect({ signedOut, gated, again, history: await fixture.history(thread) }).toMatchInlineSnapshot(`
    {
      "again": "200 ready d3",
      "gated": {
        "error": {
          "kind": "conflict",
          "message": "The provider is signed out. Run "daemon login" in a terminal, then Recheck.",
        },
      },
      "history": [
        "user: hello",
        "assistant(completed): d1: hello",
        "user: after",
        "assistant(completed): d3: after",
      ],
      "signedOut": "200 signed-out",
    }
  `);
});

function fail(): never {
  throw new Error('missing');
}
