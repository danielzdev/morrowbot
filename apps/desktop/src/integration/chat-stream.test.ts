import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_PLUGIN_TIMEOUTS } from '../../../host/src/features/plugins/index.ts';
import { startChatFixture, type ChatFixture } from '../../../host/src/testing/chat-fixture.ts';
import { sequence } from '../../../host/src/testing/test-host.ts';
import { createChatHub, type ChatHub } from '../renderer/features/chat/index.ts';
import { createApi } from '../renderer/shared/api.ts';
import { until } from '../renderer/shared/store.ts';
import { idle, loaded, running, shown } from './screens.ts';
import { openTestWindow, type TestWindow } from './test-window.ts';

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

const FAST_STOP = { ...DEFAULT_PLUGIN_TIMEOUTS, turnStopMs: 200 };

async function host(options: Parameters<typeof startChatFixture>[0] = {}): Promise<ChatFixture> {
  const chat = await startChatFixture({ timeouts: FAST_STOP, ...options });
  cleanup.push(() => chat.close());
  return chat;
}

function windowOn(chat: ChatFixture): { readonly window: TestWindow; readonly hub: ChatHub } {
  const window = openTestWindow({ url: chat.host.url, token: chat.host.host.token });
  const hub = createChatHub({ api: createApi(window.bridge), bridge: window.bridge });
  cleanup.push(() => {
    hub.close();
    window.close();
  });
  return { window, hub };
}

it('streams a reply into the chat, shows it still running after a reload, and Stop settles it as cancelled', async () => {
  const chat = await host();
  const thread = await chat.thread(await chat.agent());
  const first = windowOn(chat);
  const session = first.hub.session(thread.id);
  await loaded(session);
  session.setDraft('stall-polite');
  await session.send();
  const streaming = shown(await running(session));

  const second = windowOn(chat);
  const reloaded = second.hub.session(thread.id);
  const afterReload = shown(await running(reloaded));
  await reloaded.stop();

  expect({
    streaming,
    afterReload,
    stopped: { first: shown(await idle(session, 2)), second: shown(await idle(reloaded, 2)) },
    tokenReachedRenderer: [first, second].some(({ window }) => window.received().includes(chat.host.host.token)),
  }).toMatchInlineSnapshot(`
    {
      "afterReload": {
        "draft": "",
        "problem": null,
        "view": {
          "activeTurn": {
            "approvals": [],
            "state": "running",
            "text": "hello from pid <pid>:",
          },
          "expiredApprovals": [],
          "messages": [
            "user: stall-polite",
          ],
        },
      },
      "stopped": {
        "first": {
          "draft": "",
          "problem": null,
          "view": {
            "activeTurn": null,
            "expiredApprovals": [],
            "messages": [
              "user: stall-polite",
              "assistant: hello from pid <pid>: [Stopped.]",
            ],
          },
        },
        "second": {
          "draft": "",
          "problem": null,
          "view": {
            "activeTurn": null,
            "expiredApprovals": [],
            "messages": [
              "user: stall-polite",
              "assistant: hello from pid <pid>: [Stopped.]",
            ],
          },
        },
      },
      "streaming": {
        "draft": "",
        "problem": null,
        "view": {
          "activeTurn": {
            "approvals": [],
            "state": "running",
            "text": "hello from pid <pid>:",
          },
          "expiredApprovals": [],
          "messages": [
            "user: stall-polite",
          ],
        },
      },
      "tokenReachedRenderer": false,
    }
  `);
});

it('resyncs after the host restarts mid-turn: the cut-off reply shows as interrupted, and Continue runs it again', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'morrowbot-desktop-'));
  cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
  const ids = sequence();
  const before = await startChatFixture({ dataDir, sequence: ids, timeouts: FAST_STOP });
  const thread = await before.thread(await before.agent());
  const { window, hub } = windowOn(before);
  const session = hub.session(thread.id);
  await loaded(session);
  session.setDraft('stall');
  await session.send();
  await running(session);

  await before.close();
  const after = await host({ dataDir, sequence: ids });
  window.connect({ url: after.host.url, token: after.host.host.token });
  const resynced = shown(await idle(session, 2));

  const screen = session.screen.get();
  const failed = screen.view.kind === 'loaded' ? screen.view.value.messages.at(-1)?.id : undefined;
  await session.continueTurn(failed ?? '', { kind: 'auto' });
  const continued = shown(await running(session));
  await session.stop();

  expect({
    resynced,
    continued,
    stopped: shown(await idle(session, 3)),
    tokenReachedRenderer: window.received().includes(after.host.host.token) || window.received().includes(before.host.host.token),
  }).toMatchInlineSnapshot(`
    {
      "continued": {
        "draft": "",
        "problem": null,
        "view": {
          "activeTurn": {
            "approvals": [],
            "state": "running",
            "text": "hello from pid <pid>:",
          },
          "expiredApprovals": [],
          "messages": [
            "user: stall",
            "assistant: hello from pid <pid>: [Interrupted: MorrowBot stopped before this reply finished.] [Continue]",
          ],
        },
      },
      "resynced": {
        "draft": "",
        "problem": null,
        "view": {
          "activeTurn": null,
          "expiredApprovals": [],
          "messages": [
            "user: stall",
            "assistant: hello from pid <pid>: [Interrupted: MorrowBot stopped before this reply finished.] [Continue]",
          ],
        },
      },
      "stopped": {
        "draft": "",
        "problem": null,
        "view": {
          "activeTurn": null,
          "expiredApprovals": [],
          "messages": [
            "user: stall",
            "assistant: hello from pid <pid>: [Interrupted: MorrowBot stopped before this reply finished.] [Continue]",
            "assistant: hello from pid <pid>: [Interrupted: MorrowBot stopped before this reply finished.] [Continue]",
          ],
        },
      },
      "tokenReachedRenderer": false,
    }
  `);
});

it('keeps the history readable while the host is down, says it is reconnecting, and goes live again when the host is back', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'morrowbot-desktop-'));
  cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
  const ids = sequence();
  const before = await startChatFixture({ dataDir, sequence: ids, timeouts: FAST_STOP });
  const thread = await before.thread(await before.agent());
  const window = openTestWindow({ url: before.host.url, token: before.host.host.token });
  const hub = createChatHub({ api: createApi(window.bridge), bridge: window.bridge, reconnectMs: 50 });
  cleanup.push(() => {
    hub.close();
    window.close();
  });
  const session = hub.session(thread.id);
  await loaded(session);
  session.setDraft('hi');
  await session.send();
  await idle(session, 2);
  session.setDraft('kept while down');

  await before.close();
  const down = await until(session.screen, (screen) => screen.connection === 'reconnecting');
  const after = await host({ dataDir, sequence: ids });
  window.connect({ url: after.host.url, token: after.host.host.token });
  const back = await until(session.screen, (screen) => screen.connection === 'live' && screen.view.kind === 'loaded');
  expect({ down: { connection: down.connection, shown: shown(down) }, back: { connection: back.connection, shown: shown(back) } }).toMatchInlineSnapshot(`
    {
      "back": {
        "connection": "live",
        "shown": {
          "draft": "kept while down",
          "problem": null,
          "view": {
            "activeTurn": null,
            "expiredApprovals": [],
            "messages": [
              "user: hi",
              "assistant: hello from pid <pid>: hi",
            ],
          },
        },
      },
      "down": {
        "connection": "reconnecting",
        "shown": {
          "draft": "kept while down",
          "problem": null,
          "view": {
            "activeTurn": null,
            "expiredApprovals": [],
            "messages": [
              "user: hi",
              "assistant: hello from pid <pid>: hi",
            ],
          },
        },
      },
    }
  `);
});

it('says it is reconnecting while only the event socket is down, even when /state still answers, and goes live when the socket is back', async () => {
  const chat = await host();
  const thread = await chat.thread(await chat.agent());
  const { window, hub } = windowOn(chat);
  const session = hub.session(thread.id);
  await loaded(session);
  window.dropStream();
  const lost = session.screen.get().connection;
  await session.load();
  const afterLoad = session.screen.get();
  window.connect({ url: chat.host.url, token: chat.host.host.token });
  const back = await until(session.screen, (screen) => screen.connection === 'live');
  expect({ lost, afterLoad: [afterLoad.connection, afterLoad.view.kind], back: back.connection }).toEqual({
    lost: 'reconnecting',
    afterLoad: ['reconnecting', 'loaded'],
    back: 'live',
  });
});
