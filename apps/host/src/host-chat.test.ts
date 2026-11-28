import { StartedSend } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { hidePid, startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';

let chat: ChatFixture;
beforeEach(async () => {
  chat = await startChatFixture();
});
afterEach(async () => {
  await chat.close();
  expect(chat.host.errors).toEqual([]);
});

it('streams a reply through the echo plugin and stores it with its usage', async () => {
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  const reply = await chat.send(thread, 'hello');
  const { generationId } = StartedSend.parse(reply.body);
  expect(reply.status).toBe(202);
  expect(JSON.parse(hidePid(JSON.stringify(chat.events.of(generationId))))).toMatchInlineSnapshot(`
    [
      {
        "generationId": "id-3",
        "kind": "generation.started",
        "state": "queued",
        "threadId": "id-2",
        "userMessage": {
          "attachments": [],
          "createdAt": "2026-01-01T00:00:02.000Z",
          "id": "id-4",
          "kind": "user",
          "text": "hello",
          "threadId": "id-2",
        },
      },
      {
        "detail": null,
        "generationId": "id-3",
        "kind": "generation.status",
        "queueNote": null,
        "state": "running",
        "threadId": "id-2",
      },
      {
        "generationId": "id-3",
        "kind": "generation.delta",
        "text": "hello from pid <pid>:",
        "threadId": "id-2",
      },
      {
        "generationId": "id-3",
        "kind": "generation.delta",
        "text": " hello",
        "threadId": "id-2",
      },
      {
        "generationId": "id-3",
        "kind": "generation.finished",
        "message": {
          "attachments": [],
          "createdAt": "2026-01-01T00:00:04.000Z",
          "id": "id-5",
          "kind": "assistant",
          "outcome": {
            "finishReason": "stop",
            "kind": "completed",
          },
          "text": "hello from pid <pid>: hello",
          "threadId": "id-2",
        },
        "threadId": "id-2",
      },
    ]
  `);
  expect(await chat.history(thread)).toMatchInlineSnapshot(`
    [
      "user: hello",
      "assistant(completed): hello from pid <pid>: hello",
    ]
  `);
});
