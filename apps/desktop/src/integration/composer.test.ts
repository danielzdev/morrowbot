import { afterEach, beforeEach, expect, it } from 'vitest';
import { startChatFixture, type ChatFixture } from '../../../host/src/testing/chat-fixture.ts';
import { createChatHub, memoryDrafts, type ChatHub, type ThreadSession } from '../renderer/features/chat/index.ts';
import { createApi } from '../renderer/shared/api.ts';
import { idle, loaded, shown } from './screens.ts';
import { openTestWindow, type TestWindow } from './test-window.ts';

let chat: ChatFixture;
let window: TestWindow;
let hub: ChatHub;
const cleanup: (() => void)[] = [];

beforeEach(async () => {
  chat = await startChatFixture();
  window = openTestWindow({ url: chat.host.url, token: chat.host.host.token });
  hub = createChatHub({ api: createApi(window.bridge), bridge: window.bridge });
});

afterEach(async () => {
  for (const step of cleanup.splice(0)) step();
  hub.close();
  window.close();
  await chat.close();
  expect(chat.host.errors).toEqual([]);
});

async function typeAndSend(session: ThreadSession, text: string): Promise<unknown> {
  session.setDraft(text);
  await session.send();
  return shown(session.screen.get());
}

it('asks for a session choice on a diverged session, keeps the draft, and sends with the chosen session', async () => {
  await chat.configure({ sessions: true });
  const thread = await chat.thread(await chat.agent());
  const session = hub.session(thread.id);
  await loaded(session);
  await typeAndSend(session, 'hi');
  await idle(session, 2);
  await typeAndSend(session, 'fail');
  await idle(session, 4);
  const asked = await typeAndSend(session, 'describe');
  await session.choose({ kind: 'new-seeded' });
  await idle(session, 6);
  expect({ asked, sent: shown(session.screen.get()), history: (await chat.history(thread)).slice(-2) }).toMatchInlineSnapshot(`
    {
      "asked": {
        "draft": "describe",
        "problem": {
          "kind": "session-choice",
          "options": [
            "Continue existing (Continuing may repeat actions the provider already took.)",
            "Start a new seeded session",
          ],
          "prompt": "The provider's saved session did not finish its last turn.",
        },
        "view": {
          "activeTurn": null,
          "expiredApprovals": [],
          "messages": [
            "user: hi",
            "assistant: hello from pid <pid>: hi",
            "user: fail",
            "assistant: hello from pid <pid>: [echo failed] [Continue]",
          ],
        },
      },
      "history": [
        "user: describe",
        "assistant(completed): hello from pid <pid>: {"session":{"kind":"new","seed":"<user>\\nhi\\n</user>\\n<assistant>\\nhello from pid <pid>: hi\\n</assistant>\\n<user>\\nfail\\n</user>\\n<assistant>\\nhello from pid <pid>:\\n</assistant>"},"system":"","selection":{"kind":"default"},"expectedAccountKey":"acct-a"}",
      ],
      "sent": {
        "draft": "",
        "problem": null,
        "view": {
          "activeTurn": null,
          "expiredApprovals": [],
          "messages": [
            "user: hi",
            "assistant: hello from pid <pid>: hi",
            "user: fail",
            "assistant: hello from pid <pid>: [echo failed] [Continue]",
            "user: describe",
            "assistant: hello from pid <pid>: {"session":{"kind":"new","seed":"<user>\\nhi\\n</user>\\n<assistant>\\nhello from pid <pid>: hi\\n</assistant>\\n<user>\\nfail\\n</user>\\n<assistant>\\nhello from pid <pid>:\\n</assistant>"},"system":"","selection":{"kind":"default"},"expectedAccountKey":"acct-a"}",
          ],
        },
      },
    }
  `);
});

it('keeps the draft when the provider cannot take a send, and Retry sends the draft as edited once the provider is back', async () => {
  await chat.configure({ sessions: true, routeInfo: 'fail' });
  const thread = await chat.thread(await chat.agent());
  const session = hub.session(thread.id);
  await loaded(session);
  const refused = await typeAndSend(session, 'hi');
  const written = await chat.history(thread);
  await chat.configure({ sessions: true, routeInfo: 'ok' });
  session.setDraft('hi again');
  await session.retry();
  await idle(session, 2);
  expect({ refused, written, retried: shown(session.screen.get()) }).toMatchInlineSnapshot(`
    {
      "refused": {
        "draft": "hi",
        "problem": {
          "action": {
            "kind": "send",
            "text": "hi",
          },
          "banner": "Couldn't verify this provider's route or account.",
          "kind": "retry",
          "reason": "route-info-failed",
          "sessionChoice": {
            "kind": "auto",
          },
        },
        "view": {
          "activeTurn": null,
          "expiredApprovals": [],
          "messages": [],
        },
      },
      "retried": {
        "draft": "",
        "problem": null,
        "view": {
          "activeTurn": null,
          "expiredApprovals": [],
          "messages": [
            "user: hi again",
            "assistant: hello from pid <pid>: hi again",
          ],
        },
      },
      "written": [],
    }
  `);
});

it('keeps a chat’s draft through a 503, a 409 and a window reload, and a sent message clears it', async () => {
  const drafts = memoryDrafts();
  const reload = (): ChatHub => {
    const next = createChatHub({ api: createApi(window.bridge), bridge: window.bridge, drafts });
    cleanup.push(() => { next.close(); });
    return next;
  };
  await chat.configure({ sessions: true, routeInfo: 'fail' });
  const thread = await chat.thread(await chat.agent());
  const first = reload().session(thread.id);
  await loaded(first);
  const unavailable = await typeAndSend(first, 'plan my week');
  const afterUnavailable = reload().session(thread.id).screen.get().draft;

  await chat.configure({ sessions: true, routeInfo: 'ok' });
  const second = reload().session(thread.id);
  await loaded(second);
  second.setDraft('hi');
  await second.send();
  await idle(second, 2);
  second.setDraft('fail');
  await second.send();
  await idle(second, 4);
  const conflict = await typeAndSend(second, 'and the weekend');
  const afterConflict = reload().session(thread.id).screen.get().draft;

  const third = reload().session(thread.id);
  await loaded(third);
  await third.send();
  await third.choose({ kind: 'new-seeded' });
  await idle(third, 6);
  expect({
    refused: [unavailable, conflict].map((screen) => (screen !== null && typeof screen === 'object' && 'problem' in screen ? screen.problem : screen)),
    afterUnavailable,
    afterConflict,
    afterSend: { shown: third.screen.get().draft, stored: drafts.read(thread.id), freshWindow: reload().session(thread.id).screen.get().draft },
  }).toMatchInlineSnapshot(`
    {
      "afterConflict": "and the weekend",
      "afterSend": {
        "freshWindow": "",
        "shown": "",
        "stored": "",
      },
      "afterUnavailable": "plan my week",
      "refused": [
        {
          "action": {
            "kind": "send",
            "text": "plan my week",
          },
          "banner": "Couldn't verify this provider's route or account.",
          "kind": "retry",
          "reason": "route-info-failed",
          "sessionChoice": {
            "kind": "auto",
          },
        },
        {
          "kind": "session-choice",
          "options": [
            "Continue existing (Continuing may repeat actions the provider already took.)",
            "Start a new seeded session",
          ],
          "prompt": "The provider's saved session did not finish its last turn.",
        },
      ],
    }
  `);
});
