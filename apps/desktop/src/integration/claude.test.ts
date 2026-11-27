import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent, MessageList, Thread, type AccessLevel } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_PLUGIN_TIMEOUTS, startTestHost, type TestHost } from '../../../host/src/testing/test-host.ts';
import { createChatHub, pendingApprovals, type ChatHub, type ThreadSession } from '../renderer/features/chat/index.ts';
import { createPluginsModel, summarize, type PluginsModel } from '../renderer/features/plugins/index.ts';
import { createApi } from '../renderer/shared/api.ts';
import { until } from '../renderer/shared/store.ts';
import { idle, loaded, shown } from './screens.ts';
import { openTestWindow, type TestWindow } from './test-window.ts';

const FAKE_CLAUDE = fileURLToPath(new URL('../../../host/src/features/providers/fixtures/fake-claude.ts', import.meta.url));

let home = '';
let host: TestHost;
let window: TestWindow;
let hub: ChatHub;
let plugins: PluginsModel;

beforeEach(async () => {
  home = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-desktop-claude-')));
  vi.stubEnv('HOME', home);
  vi.stubEnv('CLAUDE_CONFIG_DIR', path.join(home, '.claude'));
  vi.stubEnv('USER', 'tester');
  /** Workspace-write (and so approvals) is offered on macOS only: these flows run as on macOS everywhere. */
  host = await startTestHost({ dataDir: path.join(home, 'data'), platform: 'darwin', timeouts: { ...DEFAULT_PLUGIN_TIMEOUTS, turnStopMs: 200 } });
  expect((await host.call('PUT', '/api/plugins/provider-claude/config', { config: { cliPath: FAKE_CLAUDE } })).status).toBe(200);
  window = openTestWindow({ url: host.url, token: host.host.token });
  const api = createApi(window.bridge);
  hub = createChatHub({ api, bridge: window.bridge });
  plugins = createPluginsModel({ api, bridge: window.bridge });
});

afterEach(async () => {
  hub.close();
  plugins.close();
  window.close();
  await host.close();
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
  expect(host.errors).toEqual([]);
  expect(window.received().includes(host.host.token)).toBe(false);
});

async function chatWith(access: AccessLevel): Promise<ThreadSession> {
  const provider = { kind: 'bound', pluginId: 'provider-claude', selection: { kind: 'default' }, access, vendorSettings: 'isolated' };
  const agent = Agent.parse((await host.call('POST', '/api/agents', { name: 'Helper', provider })).body);
  const thread = Thread.parse((await host.call('POST', `/api/agents/${agent.id}/threads`, { title: 'Chat' })).body);
  const session = hub.session(thread.id);
  await loaded(session);
  return session;
}

/** The Plugins page card for Claude: its summary line, sign-in command, and last problem. */
function claudeCard(): unknown {
  const cards = plugins.cards.get();
  const card = cards.kind === 'loaded' ? cards.value.find(({ entry }) => entry.manifest.id === 'provider-claude') : undefined;
  if (card === undefined) return cards;
  const { state, title, command } = summarize(card.entry, card.info);
  return { state, title, command: command?.replace(FAKE_CLAUDE, '<fake-claude>') ?? null, problem: card.problem, busy: card.busy };
}

it('Plugins page: Recheck shows a terminal sign-out with its command, then the sign-in, and is refused while a turn runs', async () => {
  await plugins.load();
  const ready = claudeCard();
  await mkdir(path.join(home, 'fake-claude'), { recursive: true });
  await writeFile(path.join(home, 'fake-claude', 'auth.json'), JSON.stringify({ loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' }));
  await plugins.recheck('provider-claude');
  const signedOut = claudeCard();
  await rm(path.join(home, 'fake-claude', 'auth.json'));
  await plugins.recheck('provider-claude');
  const signedIn = claudeCard();

  const session = await chatWith('read-only');
  session.setDraft('stall');
  await session.send();
  await until(session.screen, (screen) => screen.problem !== null || (screen.view.kind === 'loaded' && screen.view.value.activeTurn !== null));
  await plugins.recheck('provider-claude');
  const whileRunning = claudeCard();
  await session.stop();
  await idle(session, 2);
  expect({ ready, signedOut, signedIn, whileRunning }).toMatchInlineSnapshot(`
    {
      "ready": {
        "busy": null,
        "command": null,
        "problem": null,
        "state": "ready",
        "title": "Ready · 2.1.332 · Claude Max 5x",
      },
      "signedIn": {
        "busy": null,
        "command": null,
        "problem": null,
        "state": "ready",
        "title": "Ready · 2.1.332 · Claude Max 5x",
      },
      "signedOut": {
        "busy": null,
        "command": "<fake-claude> auth login",
        "problem": null,
        "state": "signed-out",
        "title": "Signed out",
      },
      "whileRunning": {
        "busy": null,
        "command": null,
        "problem": "Stop the turns using this provider before rechecking it.",
        "state": "ready",
        "title": "Ready · 2.1.332 · Claude Max 5x",
      },
    }
  `);
});

it('shows a rate-limited reply with its reset time and a Continue', async () => {
  const session = await chatWith('read-only');
  session.setDraft('limited');
  await session.send();
  const screen = await idle(session, 2);
  const last = screen.view.kind === 'loaded' ? screen.view.value.messages.at(-1) : undefined;
  expect({ shown: shown(screen), outcome: last?.kind === 'assistant' ? last.outcome : last }).toMatchInlineSnapshot(`
    {
      "outcome": {
        "error": {
          "kind": "rate-limited",
          "resetsAt": "2026-11-27T14:10:00.000Z",
          "windowId": "five_hour",
        },
        "kind": "failed",
      },
      "shown": {
        "draft": "",
        "problem": null,
        "view": {
          "activeTurn": null,
          "expiredApprovals": [],
          "messages": [
            "user: limited",
            "assistant:  [The provider's 5-hour limit is reached] [Continue]",
          ],
        },
      },
    }
  `);
});

const asking = (session: ThreadSession): Promise<unknown> =>
  until(session.screen, (screen) => screen.view.kind === 'loaded' && screen.view.value.activeTurn !== null && pendingApprovals(screen.view.value.activeTurn).length > 0);

function approvalId(session: ThreadSession): string {
  const view = session.screen.get().view;
  const turn = view.kind === 'loaded' ? view.value.activeTurn : null;
  return turn === null ? '' : (pendingApprovals(turn)[0]?.approvalId ?? '');
}

it('a pending approval card comes back after a reload, and Allow from the reloaded window writes the file', async () => {
  const session = await chatWith('workspace-write');
  session.setDraft('write-git');
  await session.send();
  await asking(session);
  const second = openTestWindow({ url: host.url, token: host.host.token });
  const secondHub = createChatHub({ api: createApi(second.bridge), bridge: second.bridge });
  const reloaded = secondHub.session(session.threadId);
  const afterReload = shown(await until(reloaded.screen, (screen) => screen.view.kind === 'loaded' && screen.view.value.activeTurn !== null));
  await reloaded.answer(approvalId(reloaded), 'allow');
  const answered = { first: shown(await idle(session, 2)), second: shown(await idle(reloaded, 2)) };
  secondHub.close();
  second.close();
  expect({ afterReload, answered, tokenReachedRenderer: second.received().includes(host.host.token) }).toMatchInlineSnapshot(`
    {
      "afterReload": {
        "draft": "",
        "problem": null,
        "view": {
          "activeTurn": {
            "approvals": [
              {
                "choices": [
                  "Allow",
                  "Deny",
                ],
                "summary": "Write .git/x: Claude requested permissions to edit ~/data/workspaces/id-1/.git/x which is a sensitive file.",
              },
            ],
            "state": "running",
            "text": "",
          },
          "expiredApprovals": [],
          "messages": [
            "user: write-git",
          ],
        },
      },
      "answered": {
        "first": {
          "draft": "",
          "problem": null,
          "view": {
            "activeTurn": null,
            "expiredApprovals": [],
            "messages": [
              "user: write-git",
              "assistant: Wrote .git/x",
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
              "user: write-git",
              "assistant: Wrote .git/x",
            ],
          },
        },
      },
      "tokenReachedRenderer": false,
    }
  `);
});

it('answering a stale card reloads the chat from the host and leaves the current card to answer', async () => {
  const session = await chatWith('workspace-write');
  session.setDraft('write-git');
  await session.send();
  await asking(session);
  const stale = approvalId(session);
  await session.stop();
  await idle(session, 2);
  session.setDraft('write-git');
  await session.send();
  await asking(session);
  await session.answer(stale, 'allow');
  const afterStale = shown(session.screen.get());
  await session.answer(approvalId(session), 'deny');
  expect({ afterStale, denied: shown(await idle(session, 4)) }).toMatchInlineSnapshot(`
    {
      "afterStale": {
        "draft": "",
        "problem": null,
        "view": {
          "activeTurn": {
            "approvals": [
              {
                "choices": [
                  "Allow",
                  "Deny",
                ],
                "summary": "Write .git/x: Claude requested permissions to edit ~/data/workspaces/id-1/.git/x which is a sensitive file.",
              },
            ],
            "state": "running",
            "text": "",
          },
          "expiredApprovals": [],
          "messages": [
            "user: write-git",
            "assistant:  [Stopped.]",
            "user: write-git",
          ],
        },
      },
      "denied": {
        "draft": "",
        "problem": null,
        "view": {
          "activeTurn": null,
          "expiredApprovals": [],
          "messages": [
            "user: write-git",
            "assistant:  [Stopped.]",
            "user: write-git",
            "assistant: Not written: The user denied this.",
          ],
        },
      },
    }
  `);
});

it('Continue after a rate limit reuses the saved input: the chat never gets a second user message', async () => {
  const session = await chatWith('read-only');
  session.setDraft('limited');
  await session.send();
  const limited = await idle(session, 2);
  const failed = limited.view.kind === 'loaded' ? (limited.view.value.messages.at(-1)?.id ?? '') : '';
  await session.continueTurn(failed, { kind: 'auto' });
  await until(session.screen, (screen) => screen.view.kind === 'loaded' && screen.view.value.activeTurn === null && screen.busy === null && screen.view.value.messages.at(-1)?.id !== failed);
  const history = await host.call('GET', `/api/threads/${session.threadId}/messages`);
  const kinds = MessageList.parse(history.body).messages.map(({ kind }) => kind);
  expect({ shown: shown(session.screen.get()), userMessagesOnHost: kinds.filter((kind) => kind === 'user').length }).toMatchInlineSnapshot(`
    {
      "shown": {
        "draft": "",
        "problem": null,
        "view": {
          "activeTurn": null,
          "expiredApprovals": [],
          "messages": [
            "user: limited",
            "assistant:  [The provider's 5-hour limit is reached] [Continue]",
            "assistant:  [The provider's 5-hour limit is reached] [Continue]",
          ],
        },
      },
      "userMessagesOnHost": 1,
    }
  `);
});

/** The live turn's steps, or the steps this window kept on the last reply. */
function stepsOf(session: ThreadSession): string[] {
  const view = session.screen.get().view;
  if (view.kind !== 'loaded') return [];
  const last = view.value.messages.at(-1);
  const steps = view.value.activeTurn?.steps ?? (last === undefined ? [] : (view.value.finished[last.id]?.steps ?? []));
  return steps.map((step) => (step.kind === 'tool' ? `tool ${step.name}: ${step.outcome}` : `approval: ${step.ending === null ? 'pending' : JSON.stringify(step.ending)}`));
}

it('keeps an approval card through a resync while pending, then ends it as the user chose, beside its tool row', async () => {
  const session = await chatWith('workspace-write');
  session.setDraft('write-git');
  await session.send();
  await asking(session);
  const pending = stepsOf(session);
  await session.load();
  const afterResync = stepsOf(session);
  await session.answer(approvalId(session), 'deny');
  await idle(session, 2);
  expect({ pending, afterResync, denied: stepsOf(session) }).toMatchInlineSnapshot(`
    {
      "afterResync": [
        "tool Write: running",
        "approval: pending",
      ],
      "denied": [
        "tool Write: error",
        "approval: {"kind":"chosen","label":"Deny"}",
      ],
      "pending": [
        "tool Write: running",
        "approval: pending",
      ],
    }
  `);
});
