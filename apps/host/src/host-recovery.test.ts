import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { UsageResponse } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openStorage } from './features/storage/index.ts';
import { startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';

let dataDir: string;
let chat: ChatFixture | undefined;
beforeEach(async () => {
  dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-recovery-')));
});
afterEach(async () => {
  await chat?.close();
  expect(chat?.host.errors ?? []).toEqual([]);
  chat = undefined;
  await rm(dataDir, { recursive: true, force: true });
});

async function usage(fixture: ChatFixture): Promise<UsageResponse> {
  return UsageResponse.parse((await fixture.host.call('GET', '/api/plugins/echo/usage')).body);
}

it('settles a turn a crash left open as interrupted, keeping its saved partial text', async () => {
  chat = await startChatFixture({ dataDir });
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  await chat.send(thread, 'before the crash');
  await chat.close();
  chat = undefined;
  const storage = openStorage(path.join(dataDir, 'morrowbot.sqlite'), () => '2026-01-01T01:00:00.000Z');
  storage.transaction(() => {
    storage.messages.insert({ kind: 'user', id: 'crash-input', threadId: thread.id, text: 'mid-turn', createdAt: '2026-01-01T01:00:00.000Z' });
    storage.generations.insert({
      id: 'crash-turn',
      threadId: thread.id,
      pluginId: 'echo',
      accountKey: 'acct-a',
      inputMessageId: 'crash-input',
      startedAt: '2026-01-01T01:00:00.000Z',
      attemptedSessionRow: null,
      priorState: null,
    });
    storage.generations.markDispatched('crash-turn', '2026-01-01T01:00:01.000Z');
    storage.generations.flushPartial('crash-turn', 'half a repl');
  });
  storage.close();
  chat = await startChatFixture({ dataDir, sequence: { newId: idsFrom(100), now: () => '2026-01-01T02:00:00.000Z' } });
  await chat.events.watch(thread.id);
  const next = await chat.send(thread, 'after the crash');
  expect({ next: next.status, history: await chat.history(thread) }).toMatchInlineSnapshot(`
    {
      "history": [
        "user: before the crash",
        "assistant(completed): hello from pid <pid>: before the crash",
        "user: mid-turn",
        "assistant(interrupted): half a repl",
        "user: after the crash",
        "assistant(completed): hello from pid <pid>: after the crash",
      ],
      "next": 202,
    }
  `);
});

it('serves saved usage windows for a validated account, marked stale, also after a restart; never for an unknown account', async () => {
  chat = await startChatFixture({ dataDir });
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  await chat.send(thread, 'usage');
  const afterTurn = await usage(chat);
  const updated = chat.events.received.filter((event) => event.kind === 'usage.updated');
  await chat.close();
  chat = await startChatFixture({ dataDir, sequence: { newId: idsFrom(100), now: () => '2026-01-01T00:10:00.000Z' } });
  const afterRestart = await usage(chat);
  await chat.configure({ accountKey: '' });
  const unknown = await usage(chat);
  expect({ updated, afterTurn, afterRestart, unknown }).toMatchInlineSnapshot(`
    {
      "afterRestart": {
        "persisted": true,
        "stale": true,
        "usage": {
          "accountKey": "acct-a",
          "kind": "available",
          "observedAt": "2026-01-01T00:00:05.000Z",
          "windows": [
            {
              "id": "five-hour",
              "kind": "session",
              "label": "5 hours",
              "resetsAt": null,
              "scope": {
                "kind": "account",
              },
              "usedPercent": 40,
              "windowMinutes": 300,
            },
          ],
        },
      },
      "afterTurn": {
        "persisted": true,
        "stale": true,
        "usage": {
          "accountKey": "acct-a",
          "kind": "available",
          "observedAt": "2026-01-01T00:00:05.000Z",
          "windows": [
            {
              "id": "five-hour",
              "kind": "session",
              "label": "5 hours",
              "resetsAt": null,
              "scope": {
                "kind": "account",
              },
              "usedPercent": 40,
              "windowMinutes": 300,
            },
          ],
        },
      },
      "unknown": {
        "persisted": false,
        "stale": false,
        "usage": {
          "accountKey": "",
          "kind": "unavailable",
          "observedAt": "2026-01-01T00:00:00.000Z",
          "reason": "not-yet-observed",
        },
      },
      "updated": [
        {
          "accountKey": "acct-a",
          "kind": "usage.updated",
          "pluginId": "echo",
        },
      ],
    }
  `);
});

function idsFrom(first: number): () => string {
  let next = first;
  return () => `id-${String(next++)}`;
}
