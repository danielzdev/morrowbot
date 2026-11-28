import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StartedSend, ThreadState, type Thread } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openStorage } from './features/storage/index.ts';
import { startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';

let dataDir: string;
let chat: ChatFixture | undefined;
beforeEach(async () => {
  dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'oribot-tool-steps-')));
});
afterEach(async () => {
  await chat?.close();
  expect(chat?.host.errors ?? []).toEqual([]);
  chat = undefined;
  await rm(dataDir, { recursive: true, force: true });
});

async function state(fixture: ChatFixture, thread: Thread): Promise<ThreadState> {
  return ThreadState.parse((await fixture.host.call('GET', `/api/threads/${thread.id}/state`)).body);
}

async function openGate(): Promise<void> {
  await mkdir(path.join(dataDir, 'plugin-data', 'echo'), { recursive: true });
  await writeFile(path.join(dataDir, 'plugin-data', 'echo', 'gate'), '');
}

/** Starts `tools-gate` and waits until its second tool call is running. */
async function startTools(fixture: ChatFixture, thread: Thread): Promise<string> {
  const reply = await fixture.host.call('POST', `/api/threads/${thread.id}/messages`, { text: 'tools-gate' });
  const { generationId } = StartedSend.parse(reply.body);
  await fixture.events.until((event) => event.kind === 'generation.tool-start' && event.toolUseId === 'bash-1');
  return generationId;
}

it('a reload mid-turn shows every tool call so far with its result, and the reply keeps them after the turn and a restart', async () => {
  chat = await startChatFixture({ dataDir });
  const thread = await chat.thread(await chat.agent());
  const generationId = await startTools(chat, thread);
  const midTurn = await state(chat, thread);
  await openGate();
  await chat.events.finished(generationId);
  const afterTurn = await state(chat, thread);
  await chat.close();
  chat = await startChatFixture({ dataDir });
  const afterRestart = await state(chat, thread);
  expect(afterRestart.toolSteps).toEqual(afterTurn.toolSteps);
  expect({
    midTurn: { active: midTurn.activeTurn?.toolSteps, saved: midTurn.toolSteps },
    afterTurn: { active: afterTurn.activeTurn, saved: afterTurn.toolSteps, reply: afterTurn.messages.at(-1)?.id },
  }).toMatchInlineSnapshot(`
    {
      "afterTurn": {
        "active": null,
        "reply": "id-5",
        "saved": [
          {
            "messageId": "id-5",
            "steps": [
              {
                "endedAt": "2026-01-01T00:00:05.000Z",
                "input": {
                  "file_path": "notes.md",
                },
                "name": "Read",
                "outcome": "ok",
                "startedAt": "2026-01-01T00:00:04.000Z",
                "toolUseId": "read-1",
              },
              {
                "endedAt": "2026-01-01T00:00:07.000Z",
                "input": {
                  "command": "make test",
                },
                "name": "Bash",
                "outcome": "error",
                "startedAt": "2026-01-01T00:00:06.000Z",
                "toolUseId": "bash-1",
              },
            ],
          },
        ],
      },
      "midTurn": {
        "active": [
          {
            "endedAt": "2026-01-01T00:00:05.000Z",
            "input": {
              "file_path": "notes.md",
            },
            "name": "Read",
            "outcome": "ok",
            "startedAt": "2026-01-01T00:00:04.000Z",
            "toolUseId": "read-1",
          },
          {
            "input": {
              "command": "make test",
            },
            "name": "Bash",
            "outcome": "running",
            "startedAt": "2026-01-01T00:00:06.000Z",
            "toolUseId": "bash-1",
          },
        ],
        "saved": [],
      },
    }
  `);
});

it('a turn a crash left open keeps its tool calls on the interrupted reply, the running one unfinished', async () => {
  chat = await startChatFixture({ dataDir });
  const thread = await chat.thread(await chat.agent());
  await chat.close();
  chat = undefined;
  const at = '2026-01-01T01:00:00.000Z';
  const storage = openStorage(path.join(dataDir, 'oribot.sqlite'), () => at);
  storage.transaction(() => {
    storage.messages.insert({ kind: 'user', id: 'crash-input', threadId: thread.id, text: 'mid-turn', createdAt: at, attachments: [] });
    storage.generations.insert({
      id: 'crash-turn',
      threadId: thread.id,
      pluginId: 'echo',
      accountKey: 'acct-a',
      inputMessageId: 'crash-input',
      startedAt: at,
      attemptedSessionRow: null,
      priorState: null,
    });
    storage.generations.markDispatched('crash-turn', at);
    storage.toolSteps.start({ generationId: 'crash-turn', toolUseId: 'read-1', name: 'Read', input: { file_path: 'a.md' }, startedAt: at });
    storage.toolSteps.end('crash-turn', 'read-1', 'ok', '2026-01-01T01:00:01.000Z');
    storage.toolSteps.start({ generationId: 'crash-turn', toolUseId: 'bash-1', name: 'Bash', input: { command: 'make' }, startedAt: at });
  });
  storage.close();
  chat = await startChatFixture({ dataDir, sequence: { newId: () => 'recovered', now: () => '2026-01-01T02:00:00.000Z' } });
  const recovered = await state(chat, thread);
  expect({ reply: recovered.messages.at(-1), toolSteps: recovered.toolSteps }).toMatchInlineSnapshot(`
    {
      "reply": {
        "attachments": [],
        "createdAt": "2026-01-01T02:00:00.000Z",
        "id": "recovered",
        "kind": "assistant",
        "outcome": {
          "kind": "interrupted",
        },
        "text": "",
        "threadId": "id-2",
      },
      "toolSteps": [
        {
          "messageId": "recovered",
          "steps": [
            {
              "endedAt": "2026-01-01T01:00:01.000Z",
              "input": {
                "file_path": "a.md",
              },
              "name": "Read",
              "outcome": "ok",
              "startedAt": "2026-01-01T01:00:00.000Z",
              "toolUseId": "read-1",
            },
            {
              "input": {
                "command": "make",
              },
              "name": "Bash",
              "outcome": "unfinished",
              "startedAt": "2026-01-01T01:00:00.000Z",
              "toolUseId": "bash-1",
            },
          ],
        },
      ],
    }
  `);
});
