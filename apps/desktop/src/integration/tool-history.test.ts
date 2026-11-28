import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { startChatFixture, type ChatFixture } from '../../../host/src/testing/chat-fixture.ts';
import { createChatHub, type ThreadScreen, type ThreadSession, type TurnStep } from '../renderer/features/chat/index.ts';
import { createApi } from '../renderer/shared/api.ts';
import { until } from '../renderer/shared/store.ts';
import { idle, loaded } from './screens.ts';
import { openTestWindow } from './test-window.ts';

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

function session(chat: ChatFixture, threadId: string): ThreadSession {
  const window = openTestWindow({ url: chat.host.url, token: chat.host.host.token });
  const hub = createChatHub({ api: createApi(window.bridge), bridge: window.bridge });
  cleanup.push(() => {
    hub.close();
    window.close();
  });
  return hub.session(threadId);
}

const tools = (steps: readonly TurnStep[] | undefined): string[] =>
  (steps ?? []).flatMap((step) => (step.kind === 'tool' ? [`${step.name}: ${step.outcome}`] : []));

/** The tool rows a chat shows: the running turn's, and each reply's. */
function toolRows(screen: ThreadScreen): unknown {
  if (screen.view.kind !== 'loaded') return screen.view;
  const { activeTurn, messages, finished } = screen.view.value;
  return { running: activeTurn === null ? null : tools(activeTurn.steps), replies: messages.flatMap(({ id, kind }) => (kind === 'assistant' ? [tools(finished[id]?.steps)] : [])) };
}

it('a window opened mid-turn shows each tool call and result so far, and one opened after a host restart shows them on the reply', async () => {
  const dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'oribot-tool-history-')));
  cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
  let chat = await startChatFixture({ dataDir });
  const thread = await chat.thread(await chat.agent());
  const first = session(chat, thread.id);
  await loaded(first);
  first.setDraft('tools-gate');
  await first.send();
  await chat.events.until((event) => event.kind === 'generation.tool-start' && event.toolUseId === 'bash-1');
  const midTurn = session(chat, thread.id);
  const opened = await until(midTurn.screen, (screen) => screen.view.kind === 'loaded' && (screen.view.value.activeTurn?.steps.length ?? 0) === 2);
  await mkdir(path.join(dataDir, 'plugin-data', 'echo'), { recursive: true });
  await writeFile(path.join(dataDir, 'plugin-data', 'echo', 'gate'), '');
  const ended = await idle(midTurn, 2);
  await chat.close();
  chat = await startChatFixture({ dataDir });
  cleanup.push(() => chat.close());
  const afterRestart = await loaded(session(chat, thread.id));
  expect({ midTurn: toolRows(opened), ended: toolRows(ended), afterRestart: toolRows(afterRestart) }).toMatchInlineSnapshot(`
    {
      "afterRestart": {
        "replies": [
          [
            "Read: ok",
            "Bash: error",
          ],
        ],
        "running": null,
      },
      "ended": {
        "replies": [
          [
            "Read: ok",
            "Bash: error",
          ],
        ],
        "running": null,
      },
      "midTurn": {
        "replies": [],
        "running": [
          "Read: ok",
          "Bash: running",
        ],
      },
    }
  `);
});
