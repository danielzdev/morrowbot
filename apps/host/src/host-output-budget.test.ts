import { MessageList, StartedSend, type AssistantMessage, type Thread } from '@morrowbot/contracts';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_PLUGIN_TIMEOUTS } from './features/plugins/index.ts';
import { startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';

let chat: ChatFixture | undefined;

afterEach(async () => {
  await chat?.close();
  expect(chat?.host.errors ?? []).toEqual([]);
  chat = undefined;
});

async function latestAssistant(fixture: ChatFixture, thread: Thread): Promise<AssistantMessage> {
  const { messages } = MessageList.parse((await fixture.host.call('GET', `/api/threads/${thread.id}/messages`)).body);
  const reply = messages.findLast((message) => message.kind === 'assistant');
  if (reply === undefined) throw new Error('expected an assistant reply');
  return reply;
}

it('caps streamed text at the byte budget on a UTF-8 boundary, cancels the turn, and settles as output-limit', async () => {
  chat = await startChatFixture({ turnOutputBudget: { maxBytes: 25, maxEvents: 100 } });
  const thread = await chat.thread(await chat.agent());
  const reply = await chat.send(thread, 'flood-bytes');
  const generationId = StartedSend.parse(reply.body).generationId;
  const stored = await latestAssistant(chat, thread);
  const streamed = chat.events.received
    .flatMap((event) => (event.kind === 'generation.delta' && event.generationId === generationId ? [event.text] : []))
    .join('');
  expect({
    outcome: stored.outcome,
    storedText: stored.text,
    storedBytes: Buffer.byteLength(stored.text, 'utf8'),
    streamedMatchesStored: streamed === stored.text,
  }).toMatchInlineSnapshot(`
    {
      "outcome": {
        "error": {
          "kind": "output-limit",
          "limit": "bytes",
        },
        "kind": "failed",
      },
      "storedBytes": 22,
      "storedText": "01234567890123456789ab",
      "streamedMatchesStored": true,
    }
  `);
});

it('runs the Stop ladder when a runaway provider ignores cancel after exceeding the byte budget, then serves the next turn', async () => {
  chat = await startChatFixture({
    timeouts: { ...DEFAULT_PLUGIN_TIMEOUTS, turnStopMs: 200 },
    turnOutputBudget: { maxBytes: 25, maxEvents: 100 },
  });
  const thread = await chat.thread(await chat.agent());
  await chat.send(thread, 'flood-bytes-unstoppable');
  const capped = await latestAssistant(chat, thread);
  await chat.send(thread, 'ok');
  const next = await latestAssistant(chat, thread);
  expect({
    capped: { outcome: capped.outcome, text: capped.text, bytes: Buffer.byteLength(capped.text, 'utf8') },
    nextOutcome: next.outcome,
  }).toMatchInlineSnapshot(`
    {
      "capped": {
        "bytes": 25,
        "outcome": {
          "error": {
            "kind": "output-limit",
            "limit": "bytes",
          },
          "kind": "failed",
        },
        "text": "XXXXXXXXXXXXXXXXXXXXXXXXX",
      },
      "nextOutcome": {
        "finishReason": "stop",
        "kind": "completed",
      },
    }
  `);
});

it('caps streamed chunks at the event budget, drops excess events, and settles as output-limit', async () => {
  chat = await startChatFixture({ turnOutputBudget: { maxBytes: 1_024, maxEvents: 4 } });
  const thread = await chat.thread(await chat.agent());
  const reply = await chat.send(thread, 'flood-events');
  const generationId = StartedSend.parse(reply.body).generationId;
  const stored = await latestAssistant(chat, thread);
  const statuses = chat.events.received.flatMap((event) =>
    event.kind === 'generation.status' && event.generationId === generationId && event.detail !== null ? [event.detail] : [],
  );
  expect({
    outcome: stored.outcome,
    storedText: stored.text,
    statuses,
  }).toMatchInlineSnapshot(`
    {
      "outcome": {
        "error": {
          "kind": "output-limit",
          "limit": "events",
        },
        "kind": "failed",
      },
      "statuses": [
        "step 1",
        "step 2",
        "step 3",
      ],
      "storedText": "hello",
    }
  `);
});

it('caps an oversized finalText returned without streamed chunks', async () => {
  chat = await startChatFixture({ turnOutputBudget: { maxBytes: 25, maxEvents: 100 } });
  const thread = await chat.thread(await chat.agent());
  await chat.send(thread, 'huge-final');
  const stored = await latestAssistant(chat, thread);
  expect({
    outcome: stored.outcome,
    storedText: stored.text,
    storedBytes: Buffer.byteLength(stored.text, 'utf8'),
  }).toMatchInlineSnapshot(`
    {
      "outcome": {
        "error": {
          "kind": "output-limit",
          "limit": "bytes",
        },
        "kind": "failed",
      },
      "storedBytes": 22,
      "storedText": "01234567890123456789ab",
    }
  `);
});
