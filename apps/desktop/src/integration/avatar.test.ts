import type { Agent } from '@morrowbot/contracts';
import { afterEach, expect, it } from 'vitest';
import { startChatFixture, type ChatFixture } from '../../../host/src/testing/chat-fixture.ts';
import { createAgentsModel } from '../renderer/features/agents/index.ts';
import { choose, motionOf, type AvatarChoice } from '../renderer/features/avatar/index.ts';
import { createChatHub, type ChatActivity, type ChatHub } from '../renderer/features/chat/index.ts';
import { createApi } from '../renderer/shared/api.ts';
import { until } from '../renderer/shared/store.ts';
import { idle, loaded } from './screens.ts';
import { openTestWindow, type TestWindow } from './test-window.ts';

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function host(): Promise<ChatFixture> {
  const chat = await startChatFixture();
  cleanup.push(async () => {
    await chat.close();
    expect(chat.host.errors).toEqual([]);
  });
  return chat;
}

function windowOn(chat: ChatFixture): TestWindow {
  const window = openTestWindow({ url: chat.host.url, token: chat.host.host.token });
  cleanup.push(() => {
    window.close();
  });
  return window;
}

it("moves the avatar with its chat: working while it streams, a celebration when it completes, then rest; a failed turn doesn't celebrate", async () => {
  const chat = await host();
  const window = windowOn(chat);
  const hub: ChatHub = createChatHub({ api: createApi(window.bridge), bridge: window.bridge, completedMs: 50 });
  cleanup.push(() => {
    hub.close();
  });
  const thread = await chat.thread(await chat.agent());
  const shown: string[] = [];
  let last: ChatActivity | undefined;
  hub.activity.subscribe((activity) => {
    const now = activity[thread.id];
    if (now === last) return;
    last = now;
    shown.push(now === undefined ? 'closed' : `${now} → ${motionOf(now).state}${motionOf(now).paused ? ' (paused)' : ''}`);
  });
  const session = hub.session(thread.id);
  await loaded(session);
  for (const [text, messages] of [['hi', 2], ['fail', 4]] as const) {
    session.setDraft(text);
    await session.send();
    await idle(session, messages);
    await until(hub.activity, (activity) => activity[thread.id] === 'idle');
    shown.push('---');
  }
  hub.forget(thread.id);
  expect(shown).toMatchInlineSnapshot(`
    [
      "idle → idle (paused)",
      "queued → waiting",
      "thinking → thinking",
      "streaming → working",
      "completed → done",
      "idle → idle (paused)",
      "---",
      "queued → waiting",
      "thinking → thinking",
      "streaming → working",
      "idle → idle (paused)",
      "---",
      "closed",
    ]
  `);
});

it('keeps each agent its own avatar: every picked shape, color and finish is saved and read back from the host', async () => {
  const chat = await host();
  const window = windowOn(chat);
  const api = createApi(window.bridge);
  const [planner, writer] = [await chat.agent(), await chat.agent()];
  const model = createAgentsModel({ api, bridge: window.bridge });
  cleanup.push(() => {
    model.close();
  });
  await model.load();
  const picks: readonly AvatarChoice[] = [
    { kind: 'shape', shape: 'lightbulb' },
    { kind: 'color', color: '#EC4899' },
    { kind: 'finish', finish: 'fluffy' },
    { kind: 'finish', finish: 'matte' },
    { kind: 'finish', finish: 'metallic' },
  ];
  const saved: string[] = [];
  let avatar = planner.avatar;
  for (const pick of picks) {
    avatar = choose(avatar, pick);
    const result = await model.updateAgent(planner.id, { avatar });
    saved.push(result.kind === 'saved' ? `${result.value.avatar.shape} ${result.value.avatar.color} ${result.value.avatar.finish}` : result.message);
  }

  const fresh = createAgentsModel({ api: createApi(windowOn(chat).bridge), bridge: window.bridge });
  cleanup.push(() => {
    fresh.close();
  });
  await fresh.load();
  const agents = await until(fresh.state, (state) => state.agents.kind === 'loaded');
  const byId = (agent: Agent) => (agents.agents.kind === 'loaded' ? agents.agents.value.find(({ id }) => id === agent.id)?.avatar : undefined);
  expect({ saved, readBack: { planner: byId(planner), writer: byId(writer) } }).toMatchInlineSnapshot(`
    {
      "readBack": {
        "planner": {
          "color": "#ec4899",
          "finish": "metallic",
          "kind": "bot",
          "shape": "lightbulb",
        },
        "writer": {
          "color": "#6b7280",
          "finish": "flat",
          "kind": "bot",
          "shape": "chat",
        },
      },
      "saved": [
        "lightbulb #6b7280 flat",
        "lightbulb #ec4899 flat",
        "lightbulb #ec4899 fluffy",
        "lightbulb #ec4899 matte",
        "lightbulb #ec4899 metallic",
      ],
    }
  `);
});
