import { afterEach, beforeEach, expect, it } from 'vitest';
import { startChatFixture, type ChatFixture } from '../../../host/src/testing/chat-fixture.ts';
import { createChatHub, memoryDrafts, type ChatHub, type ThreadScreen, type ThreadSession } from '../renderer/features/chat/index.ts';
import { createApi } from '../renderer/shared/api.ts';
import { until } from '../renderer/shared/store.ts';
import { idle, loaded, running, shown } from './screens.ts';
import { openTestWindow, type TestWindow } from './test-window.ts';

let chat: ChatFixture;
let window: TestWindow;
let hub: ChatHub;

beforeEach(async () => {
  chat = await startChatFixture();
  window = openTestWindow({ url: chat.host.url, token: chat.host.host.token });
  hub = createChatHub({ api: createApi(window.bridge), bridge: window.bridge, drafts: memoryDrafts() });
});

afterEach(async () => {
  hub.close();
  window.close();
  await chat.close();
  expect(chat.host.errors).toEqual([]);
});

const queueOf = (screen: ThreadScreen) => (screen.view.kind === 'loaded' ? screen.view.value.queue.map(({ text, state }) => ({ text, state: state.kind })) : []);
const queued = (session: ThreadSession, count: number) => until(session.screen, (screen) => queueOf(screen).length === count);

it('a message sent during a reply shows as queued; Edit puts it back in the box; Steer now sends it into the reply', async () => {
  const thread = await chat.thread(await chat.agent());
  const session = hub.session(thread.id);
  await loaded(session);
  session.setDraft('steerable');
  await session.send();
  await running(session);
  session.setDraft('first try');
  await session.send();
  const whileRunning = queueOf(await queued(session, 1));
  const id = (): string => {
    const screen = session.screen.get();
    return screen.view.kind === 'loaded' ? (screen.view.value.queue[0]?.id ?? '') : '';
  };
  session.setDraft('and more');
  await session.editQueued(id());
  const afterEdit = await queued(session, 0);
  session.setDraft('what is 2+2?');
  await session.send();
  await queued(session, 1);
  await session.steer(id());
  const done = await idle(session, 4);
  expect({ whileRunning, draftAfterEdit: afterEdit.draft, done: shown(done), queueAfter: queueOf(done) }).toMatchInlineSnapshot(`
    {
      "done": {
        "draft": "",
        "problem": null,
        "view": {
          "activeTurn": null,
          "expiredApprovals": [],
          "messages": [
            "user: steerable",
            "assistant: hello from pid <pid>: [Paused here for your message.]",
            "user: what is 2+2?",
            "assistant:  heard: [The user typed this message in the chat while you were working. It is from the user, not from a tool. Reply to it visibly in your next message, and answer it if it is a question; then carry on with your task with it taken into account.]

    what is 2+2?",
          ],
        },
      },
      "draftAfterEdit": "first try

    and more",
      "queueAfter": [],
      "whileRunning": [
        {
          "state": "queued",
          "text": "first try",
        },
      ],
    }
  `);
});
