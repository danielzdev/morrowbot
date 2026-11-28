import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { QueuedSend, StartedSend, ThreadState, type ChatEvent, type QueuedMessage, type Thread } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { hidePid, startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';

let dataDir: string;
let chat: ChatFixture | undefined;
beforeEach(async () => {
  dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-steer-')));
});
afterEach(async () => {
  await chat?.close();
  expect(chat?.host.errors ?? []).toEqual([]);
  chat = undefined;
  await rm(dataDir, { recursive: true, force: true });
});

const post = (fixture: ChatFixture, thread: Thread, text: string) => fixture.host.call('POST', `/api/threads/${thread.id}/messages`, { text });

async function start(fixture: ChatFixture, thread: Thread, text: string): Promise<string> {
  const { generationId } = StartedSend.parse((await post(fixture, thread, text)).body);
  await fixture.events.until((event) => event.kind === 'generation.delta' && event.generationId === generationId);
  return generationId;
}

async function queue(fixture: ChatFixture, thread: Thread, text: string): Promise<QueuedMessage> {
  return QueuedSend.parse((await post(fixture, thread, text)).body).queued;
}

async function state(fixture: ChatFixture, thread: Thread): Promise<ThreadState> {
  return ThreadState.parse((await fixture.host.call('GET', `/api/threads/${thread.id}/state`)).body);
}

/** Resolves once the turn that delivers `queuedId` has finished. */
async function delivered(fixture: ChatFixture, queuedId: string): Promise<void> {
  const startedBy = (event: ChatEvent): boolean => event.kind === 'generation.started' && event.userMessage?.id === queuedId;
  await fixture.events.until(startedBy);
  const started = fixture.events.received.find(startedBy);
  if (started?.kind === 'generation.started') await fixture.events.finished(started.generationId);
}

/** Each `queue.changed` as `text: state` lines. */
function queueChanges(fixture: ChatFixture): string[][] {
  return fixture.events.received.flatMap((event) =>
    event.kind === 'queue.changed' ? [event.queue.map((item) => `${item.text}: ${JSON.stringify(item.state)}`)] : [],
  );
}

async function openGate(): Promise<void> {
  await mkdir(path.join(dataDir, 'plugin-data', 'echo'), { recursive: true });
  await writeFile(path.join(dataDir, 'plugin-data', 'echo', 'gate'), '');
}

it('a message sent during a reply waits as queued, unseen, and runs as the next turn once the reply completes', async () => {
  chat = await startChatFixture({ dataDir });
  const thread = await chat.thread(await chat.agent());
  await start(chat, thread, 'gate');
  const queued = await queue(chat, thread, 'and then this');
  const during = await state(chat, thread);
  await openGate();
  await delivered(chat, queued.id);
  expect({
    queued,
    during: { queue: during.queue, messages: during.messages.map(({ text }) => text) },
    queueChanges: queueChanges(chat),
    history: await chat.history(thread),
    after: (await state(chat, thread)).queue,
  }).toMatchInlineSnapshot(`
    {
      "after": [],
      "during": {
        "messages": [
          "gate",
        ],
        "queue": [
          {
            "createdAt": "2026-01-01T00:00:04.000Z",
            "id": "id-5",
            "state": {
              "kind": "queued",
            },
            "text": "and then this",
            "threadId": "id-2",
          },
        ],
      },
      "history": [
        "user: gate",
        "assistant(completed): hello from pid <pid>:",
        "user: and then this",
        "assistant(completed): hello from pid <pid>: and then this",
      ],
      "queueChanges": [
        [
          "and then this: {"kind":"queued"}",
        ],
        [],
      ],
      "queued": {
        "createdAt": "2026-01-01T00:00:04.000Z",
        "id": "id-5",
        "state": {
          "kind": "queued",
        },
        "text": "and then this",
        "threadId": "id-2",
      },
    }
  `);
});

it('Steer now on a provider that takes steers mid-turn saves the reply so far, then the message, and the turn answers it', async () => {
  chat = await startChatFixture({ dataDir });
  const thread = await chat.thread(await chat.agent());
  const generationId = await start(chat, thread, 'steerable');
  const queued = await queue(chat, thread, 'what is 2+2?');
  const steer = await chat.host.call('POST', `/api/threads/${thread.id}/queue/${queued.id}/steer`);
  await chat.events.finished(generationId);
  const steered = chat.events.received.find((event) => event.kind === 'generation.steered');
  const seen = {
    steer: steer.status,
    steered: steered?.kind === 'generation.steered' ? { segment: steered.segment, userMessage: steered.userMessage } : null,
    queueChanges: queueChanges(chat),
    history: await chat.history(thread),
  };
  expect(JSON.parse(hidePid(JSON.stringify(seen)))).toMatchInlineSnapshot(`
    {
      "history": [
        "user: steerable",
        "assistant(steered): hello from pid <pid>:",
        "user: what is 2+2?",
        "assistant(completed):  heard: [The user typed this message in the chat while you were working. It is from the user, not from a tool. Reply to it visibly in your next message, and answer it if it is a question; then carry on with your task with it taken into account.]

    what is 2+2?",
      ],
      "queueChanges": [
        [
          "what is 2+2?: {"kind":"queued"}",
        ],
        [
          "what is 2+2?: {"kind":"steering","via":"native"}",
        ],
        [],
      ],
      "steer": 204,
      "steered": {
        "segment": {
          "createdAt": "2026-01-01T00:00:05.000Z",
          "id": "id-6",
          "kind": "assistant",
          "outcome": {
            "kind": "steered",
          },
          "text": "hello from pid <pid>:",
          "threadId": "id-2",
        },
        "userMessage": {
          "attachments": [],
          "createdAt": "2026-01-01T00:00:05.000Z",
          "id": "id-5",
          "kind": "user",
          "text": "what is 2+2?",
          "threadId": "id-2",
        },
      },
    }
  `);
});

it('Steer now on a provider without mid-turn input stops the reply as steered and runs the message next, asking for an answer first', async () => {
  chat = await startChatFixture({ dataDir });
  const thread = await chat.thread(await chat.agent());
  await start(chat, thread, 'stall-polite');
  const queued = await queue(chat, thread, 'use tabs, not spaces');
  await chat.host.call('POST', `/api/threads/${thread.id}/queue/${queued.id}/steer`);
  await delivered(chat, queued.id);
  expect({ queueChanges: queueChanges(chat), history: await chat.history(thread) }).toMatchInlineSnapshot(`
    {
      "history": [
        "user: stall-polite",
        "assistant(steered): hello from pid <pid>:",
        "user: use tabs, not spaces",
        "assistant(completed): hello from pid <pid>: [The user interrupted your work with this message. Reply to it visibly first, and answer it if it is a question; then carry on with the task you were doing, with it taken into account.]

    use tabs, not spaces",
      ],
      "queueChanges": [
        [
          "use tabs, not spaces: {"kind":"queued"}",
        ],
        [
          "use tabs, not spaces: {"kind":"steering","via":"native"}",
        ],
        [
          "use tabs, not spaces: {"kind":"steering","via":"interrupt"}",
        ],
        [],
      ],
    }
  `);
});

it('Stop holds the queue; a held message can be cancelled or sent, and a new send is not queued behind it', async () => {
  chat = await startChatFixture({ dataDir });
  const thread = await chat.thread(await chat.agent());
  await start(chat, thread, 'stall-polite');
  const keep = await queue(chat, thread, 'keep me');
  const drop = await queue(chat, thread, 'drop me');
  await chat.host.call('POST', `/api/threads/${thread.id}/stop`);
  const held = (await state(chat, thread)).queue;
  const cancel = await chat.host.call('DELETE', `/api/threads/${thread.id}/queue/${drop.id}`);
  const again = await chat.host.call('DELETE', `/api/threads/${thread.id}/queue/${drop.id}`);
  const fresh = await chat.send(thread, 'a new message');
  const sendNow = await chat.host.call('POST', `/api/threads/${thread.id}/queue/${keep.id}/steer`);
  await delivered(chat, keep.id);
  expect({
    held: held.map(({ text, state: where }) => ({ text, state: where })),
    cancel: cancel.status,
    cancelAgain: again.status,
    fresh: StartedSend.safeParse(fresh.body).success,
    sendNow: sendNow.status,
    history: await chat.history(thread),
    after: (await state(chat, thread)).queue,
  }).toMatchInlineSnapshot(`
    {
      "after": [],
      "cancel": 204,
      "cancelAgain": 404,
      "fresh": true,
      "held": [
        {
          "state": {
            "kind": "held",
            "reason": "Not sent: you stopped the reply.",
          },
          "text": "keep me",
        },
        {
          "state": {
            "kind": "held",
            "reason": "Not sent: you stopped the reply.",
          },
          "text": "drop me",
        },
      ],
      "history": [
        "user: stall-polite",
        "assistant(cancelled): hello from pid <pid>:",
        "user: a new message",
        "assistant(completed): hello from pid <pid>: a new message",
        "user: keep me",
        "assistant(completed): hello from pid <pid>: keep me",
      ],
      "sendNow": 204,
    }
  `);
});

it('a queued message survives a host restart, held until the user sends it', async () => {
  chat = await startChatFixture({ dataDir });
  const thread = await chat.thread(await chat.agent());
  await start(chat, thread, 'stall-polite');
  await queue(chat, thread, 'still here?');
  await chat.close();
  chat = await startChatFixture({ dataDir });
  expect(JSON.parse(hidePid(JSON.stringify((await state(chat, thread)).queue)))).toMatchInlineSnapshot(`
    [
      {
        "createdAt": "2026-01-01T00:00:04.000Z",
        "id": "id-5",
        "state": {
          "kind": "held",
          "reason": "Not sent: MorrowBot restarted before the agent saw it.",
        },
        "text": "still here?",
        "threadId": "id-2",
      },
    ]
  `);
});
