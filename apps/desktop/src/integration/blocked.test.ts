import type { BlockedGroup } from '@morrowbot/contracts';
import { afterEach, expect, it } from 'vitest';
import { systemProbe, type ProcessProbe } from '../../../host/src/features/plugins/index.ts';
import { startChatFixture, type ChatFixture } from '../../../host/src/testing/chat-fixture.ts';
import { createChatHub, type ChatHub, type ThreadSession } from '../renderer/features/chat/index.ts';
import { createPluginsModel, type PluginsModel } from '../renderer/features/plugins/index.ts';
import { createApi } from '../renderer/shared/api.ts';
import { until } from '../renderer/shared/store.ts';
import { idle, loaded } from './screens.ts';
import { openTestWindow, type TestWindow } from './test-window.ts';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

/** The real probe, except that while `stuck` every group looks alive with an unreadable leader. */
function stickyProbe(): { probe: ProcessProbe; stick: () => void } {
  let stuck = false;
  return {
    probe: {
      signalGroup: (pgid) => (stuck ? 'denied' : systemProbe.signalGroup(pgid)),
      leader: async (pid) => (stuck ? { kind: 'unreadable' } : systemProbe.leader(pid)),
      bootId: () => systemProbe.bootId(),
    },
    stick: () => {
      stuck = true;
    },
  };
}

const groupsShown = (groups: readonly BlockedGroup[]): unknown => groups.map(({ pluginId, kind, releasable }) => ({ pluginId, kind, releasable }));

function chatGroups(session: ThreadSession): readonly BlockedGroup[] {
  const { view } = session.screen.get();
  return view.kind === 'loaded' ? view.value.blockedGroups : [];
}

function pluginGroups(plugins: PluginsModel): readonly BlockedGroup[] {
  const cards = plugins.cards.get();
  return cards.kind === 'loaded' ? (cards.value.find(({ entry }) => entry.manifest.id === 'echo')?.entry.blockedGroups ?? []) : [];
}

async function eventually(check: () => boolean): Promise<void> {
  while (!check()) await new Promise((resolve) => setTimeout(resolve, 20));
}

it('a Stop that leaves a process group blocked shows it in the chat and on Plugins, and Release anyway there frees the chat', async () => {
  const { probe, stick } = stickyProbe();
  let skipped = 0;
  const chat: ChatFixture = await startChatFixture({ probe, clock: { now: () => new Date().toISOString(), monotonic: () => performance.now() + skipped } });
  cleanup.push(() => chat.close());
  const window: TestWindow = openTestWindow({ url: chat.host.url, token: chat.host.host.token });
  cleanup.push(() => {
    window.close();
  });
  const api = createApi(window.bridge);
  const hubs: ChatHub[] = [];
  const plugins = createPluginsModel({
    api,
    bridge: window.bridge,
    onReleased: () => {
      for (const each of hubs) each.reloadAll();
    },
  });
  const hub = createChatHub({ api, bridge: window.bridge, onGroupsChanged: () => void plugins.load() });
  hubs.push(hub);
  cleanup.push(() => {
    hub.close();
    plugins.close();
  });
  await plugins.load();

  const thread = await chat.thread(await chat.agent());
  const session = hub.session(thread.id);
  await loaded(session);
  session.setDraft('sleep');
  await session.send();
  const started = await until(session.screen, (screen) => screen.view.kind === 'loaded' && screen.view.value.activeTurn !== null);
  const generationId = started.view.kind === 'loaded' ? started.view.value.activeTurn?.generationId : undefined;
  if (generationId === undefined) throw new Error('no running turn');
  await eventually(() => chat.host.host.plugins.groups.groupsOf(new Set([generationId])).length > 0);
  stick();
  await session.stop();
  await eventually(() => pluginGroups(plugins).length > 0);
  const afterStop = { chat: groupsShown(chatGroups(session)), plugins: groupsShown(pluginGroups(plugins)) };

  skipped = 61_000;
  await plugins.load();
  const [group] = pluginGroups(plugins);
  if (group === undefined) throw new Error('no blocked group');
  await plugins.release('echo', group.regId);
  await eventually(() => chatGroups(session).length === 0);
  const afterRelease = { chat: groupsShown(chatGroups(session)), plugins: groupsShown(pluginGroups(plugins)) };
  session.setDraft('after');
  await session.send();
  await idle(session, 4);

  expect({ afterStop, afterRelease, sentAfterRelease: await chat.history(thread) }).toMatchInlineSnapshot(`
    {
      "afterRelease": {
        "chat": [],
        "plugins": [],
      },
      "afterStop": {
        "chat": [
          {
            "kind": "turn",
            "pluginId": "echo",
            "releasable": false,
          },
        ],
        "plugins": [
          {
            "kind": "turn",
            "pluginId": "echo",
            "releasable": false,
          },
        ],
      },
      "sentAfterRelease": [
        "user: sleep",
        "assistant(cancelled): hello from pid <pid>:",
        "user: after",
        "assistant(completed): hello from pid <pid>: after",
      ],
    }
  `);
});
