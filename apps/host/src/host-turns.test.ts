import { rm } from 'node:fs/promises';
import { MessageList, StartedSend, ThreadState, type Thread } from '@morrowbot/contracts';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_PLUGIN_TIMEOUTS } from './features/plugins/index.ts';
import { hidePid, startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';

let chat: ChatFixture | undefined;
afterEach(async () => {
  await chat?.close();
  expect(chat?.host.errors ?? []).toEqual([]);
  chat = undefined;
});

async function start(fixture: ChatFixture, thread: Thread, text: string): Promise<string> {
  const reply = await fixture.host.call('POST', `/api/threads/${thread.id}/messages`, { text });
  return StartedSend.parse(reply.body).generationId;
}

async function state(fixture: ChatFixture, thread: Thread): Promise<ThreadState> {
  return ThreadState.parse((await fixture.host.call('GET', `/api/threads/${thread.id}/state`)).body);
}

function scrub(value: unknown): unknown {
  return JSON.parse(hidePid(JSON.stringify(value)));
}

it('Stop waits for the turn to end, and /state shows text streamed since the last flush', async () => {
  chat = await startChatFixture();
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  const generationId = await start(chat, thread, 'stall-polite');
  await chat.events.until((event) => event.kind === 'generation.delta' && event.generationId === generationId);
  const during = await state(chat, thread);
  const stopped = await chat.host.call('POST', `/api/threads/${thread.id}/stop`);
  const after = await state(chat, thread);
  expect(scrub({ during: during.activeTurn, stopped: stopped.body, after: after.activeTurn })).toMatchInlineSnapshot(`
    {
      "after": null,
      "during": {
        "generationId": "id-3",
        "pendingApprovals": [],
        "queueNote": null,
        "state": "running",
        "text": "hello from pid <pid>:",
      },
      "stopped": {
        "kind": "stopped",
        "message": {
          "createdAt": "2026-01-01T00:00:04.000Z",
          "id": "id-5",
          "kind": "assistant",
          "outcome": {
            "kind": "cancelled",
          },
          "text": "hello from pid <pid>:",
          "threadId": "id-2",
        },
      },
    }
  `);
});

it('kills a worker that ignores cancel, settles the turn interrupted, and serves the next turn from a new worker', async () => {
  chat = await startChatFixture({ timeouts: { ...DEFAULT_PLUGIN_TIMEOUTS, turnStopMs: 200 } });
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  const generationId = await start(chat, thread, 'stall');
  await chat.events.until((event) => event.kind === 'generation.delta' && event.generationId === generationId);
  const stopped = await chat.host.call('POST', `/api/threads/${thread.id}/stop`);
  const next = await chat.send(thread, 'after');
  expect({ stopped: stopped.status, next: next.status, history: await chat.history(thread) }).toMatchInlineSnapshot(`
    {
      "history": [
        "user: stall",
        "assistant(interrupted): hello from pid <pid>:",
        "user: after",
        "assistant(completed): hello from pid <pid>: after",
      ],
      "next": 202,
      "stopped": 200,
    }
  `);
});

it('queues a third turn on one account, shows why, and cancels it on Stop without touching a worker', async () => {
  chat = await startChatFixture();
  const agent = await chat.agent();
  const one = await chat.thread(agent, 'One');
  const two = await chat.thread(agent, 'Two');
  const three = await chat.thread(agent, 'Three');
  await start(chat, one, 'stall-polite');
  const second = await start(chat, two, 'stall-polite');
  const third = await start(chat, three, 'stall-polite');
  await chat.events.until((event) => event.kind === 'generation.delta' && event.generationId === second);
  const queued = await state(chat, three);
  const stopQueued = await chat.host.call('POST', `/api/threads/${three.id}/stop`);
  await chat.host.call('POST', `/api/threads/${one.id}/stop`);
  await chat.host.call('POST', `/api/threads/${two.id}/stop`);
  expect(scrub({ queued: queued.activeTurn, stopQueued: stopQueued.body, events: chat.events.of(third) })).toMatchInlineSnapshot(`
    {
      "events": [
        {
          "generationId": "id-9",
          "kind": "generation.started",
          "state": "queued",
          "threadId": "id-4",
          "userMessage": {
            "attachments": [],
            "createdAt": "2026-01-01T00:00:08.000Z",
            "id": "id-10",
            "kind": "user",
            "text": "stall-polite",
            "threadId": "id-4",
          },
        },
        {
          "detail": null,
          "generationId": "id-9",
          "kind": "generation.status",
          "queueNote": "Waiting for one of 2 running turns to finish",
          "state": "queued",
          "threadId": "id-4",
        },
        {
          "generationId": "id-9",
          "kind": "generation.finished",
          "message": {
            "createdAt": "2026-01-01T00:00:09.000Z",
            "id": "id-11",
            "kind": "assistant",
            "outcome": {
              "kind": "cancelled",
            },
            "text": "",
            "threadId": "id-4",
          },
          "threadId": "id-4",
        },
      ],
      "queued": {
        "generationId": "id-9",
        "pendingApprovals": [],
        "queueNote": "Waiting for one of 2 running turns to finish",
        "state": "queued",
        "text": "",
      },
      "stopQueued": {
        "kind": "stopped",
        "message": {
          "createdAt": "2026-01-01T00:00:09.000Z",
          "id": "id-11",
          "kind": "assistant",
          "outcome": {
            "kind": "cancelled",
          },
          "text": "",
          "threadId": "id-4",
        },
      },
    }
  `);
});

it('replays missed events from a cursor with no gaps or repeats, and /state matches a cold load', async () => {
  chat = await startChatFixture();
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  await chat.send(thread, 'first');
  const midway = await state(chat, thread);
  await chat.send(thread, 'second');
  const live = chat.events.received.filter((event) => event.kind !== 'usage.updated' && event.cursor.seq > midway.cursor.seq);
  const late = await chat.host.events();
  late.subscribe(thread.id, midway.cursor);
  await late.until((event) => event.kind === 'generation.finished');
  const cold = await state(chat, thread);
  const { messages } = MessageList.parse((await chat.host.call('GET', `/api/threads/${thread.id}/messages`)).body);
  expect(late.received).toEqual(live);
  expect(cold.messages).toEqual(messages);
  expect(late.received.map((event) => (event.kind === 'usage.updated' ? event.kind : `${String(event.cursor.seq)} ${event.kind}`))).toMatchInlineSnapshot(`
    [
      "6 generation.started",
      "7 generation.status",
      "8 generation.delta",
      "9 generation.delta",
      "10 generation.finished",
    ]
  `);
});

it('sends resync to a cursor from an earlier host start', async () => {
  chat = await startChatFixture();
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  await chat.send(thread, 'first');
  const before = await state(chat, thread);
  const { dataDir } = chat;
  await chat.host.close();
  chat = undefined;
  const restarted = await startChatFixture({ dataDir });
  try {
    const client = await restarted.host.events();
    client.subscribe(thread.id, before.cursor);
    const fresh = await client.watch(thread.id);
    await restarted.events.watch(thread.id);
    await restarted.send(thread, 'second');
    expect({ resyncs: client.resyncs, epochChanged: fresh.cursor.hostEpoch !== before.cursor.hostEpoch }).toMatchInlineSnapshot(`
      {
        "epochChanged": true,
        "resyncs": [
          "id-2",
        ],
      }
    `);
  } finally {
    await restarted.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

it('refuses a provider recheck while it has a turn, and runs it once the turn is stopped', async () => {
  chat = await startChatFixture();
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  const generationId = await start(chat, thread, 'stall-polite');
  await chat.events.until((event) => event.kind === 'generation.delta' && event.generationId === generationId);
  const during = await chat.host.call('POST', '/api/plugins/echo/recheck');
  await chat.host.call('POST', `/api/threads/${thread.id}/stop`);
  const after = await chat.host.call('POST', '/api/plugins/echo/recheck');
  expect({ during, after: after.status }).toMatchInlineSnapshot(`
    {
      "after": 200,
      "during": {
        "body": {
          "error": {
            "kind": "conflict",
            "message": "Stop the turns using this provider before rechecking it.",
          },
        },
        "status": 409,
      },
    }
  `);
});

it('ends a command the plugin left running when its turn ends, so the thread is free at once', async () => {
  chat = await startChatFixture();
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  const left = await chat.send(thread, 'leave-running');
  const next = await chat.send(thread, 'after');
  expect({ left: left.status, next: next.status, history: await chat.history(thread) }).toMatchInlineSnapshot(`
    {
      "history": [
        "user: leave-running",
        "assistant(completed): hello from pid <pid>: leave-running",
        "user: after",
        "assistant(completed): hello from pid <pid>: after",
      ],
      "left": 202,
      "next": 202,
    }
  `);
});
