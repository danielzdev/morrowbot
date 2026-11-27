import { ContinueResponse, MessageList, SendMessageResponse } from '@morrowbot/contracts';
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

async function latestId(threadId: string): Promise<string> {
  const { messages } = MessageList.parse((await chat.host.call('GET', `/api/threads/${threadId}/messages`)).body);
  const latest = messages.at(-1);
  if (latest === undefined) throw new Error('no messages');
  return latest.id;
}

it('runs a Continue once for a double-click, with the saved input sent once and left out of the seed', async () => {
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  await chat.send(thread, 'earlier');
  await chat.send(thread, 'once-fail');
  const failedMessageId = await latestId(thread.id);
  const [first, second] = await Promise.all([
    chat.host.call('POST', `/api/threads/${thread.id}/continue`, { failedMessageId }),
    chat.host.call('POST', `/api/threads/${thread.id}/continue`, { failedMessageId }),
  ]);
  const { generationId } = ContinueResponse.parse(first.body);
  await chat.events.finished(generationId);
  const again = await chat.host.call('POST', `/api/threads/${thread.id}/continue`, { failedMessageId });
  expect({ first: first.status, second: second.body, again: again.body, generationId }).toMatchInlineSnapshot(`
    {
      "again": {
        "generationId": "id-9",
      },
      "first": 202,
      "generationId": "id-9",
      "second": {
        "generationId": "id-9",
      },
    }
  `);
  expect(await chat.history(thread)).toMatchInlineSnapshot(`
    [
      "user: earlier",
      "assistant(completed): hello from pid <pid>: earlier",
      "user: once-fail",
      "assistant(failed other): hello from pid <pid>:",
      "assistant(completed): hello from pid <pid>: {"session":{"kind":"new","seed":"<user>\\nearlier\\n</user>\\n<assistant>\\nhello from pid <pid>: earlier\\n</assistant>"}}",
    ]
  `);
});

it('refuses a Continue on a message that is not the latest, on a completed reply, and on a busy thread', async () => {
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  await chat.send(thread, 'fail');
  const failed = await latestId(thread.id);
  await chat.send(thread, 'fine');
  const completed = await latestId(thread.id);
  const busyThread = await chat.thread(agent, 'Busy');
  await chat.send(busyThread, 'fail');
  const busyFailed = await latestId(busyThread.id);
  const running = SendMessageResponse.safeParse(
    (await chat.host.call('POST', `/api/threads/${busyThread.id}/messages`, { text: 'stall-polite' })).body,
  );
  const replies = {
    notLatest: await chat.host.call('POST', `/api/threads/${thread.id}/continue`, { failedMessageId: failed }),
    completed: await chat.host.call('POST', `/api/threads/${thread.id}/continue`, { failedMessageId: completed }),
    busy: await chat.host.call('POST', `/api/threads/${busyThread.id}/continue`, { failedMessageId: busyFailed }),
  };
  expect(running.success).toBe(true);
  await chat.host.call('POST', `/api/threads/${busyThread.id}/stop`);
  expect(replies).toMatchInlineSnapshot(`
    {
      "busy": {
        "body": {
          "error": {
            "kind": "conflict",
            "message": "This thread is already generating a reply. Stop it first.",
          },
        },
        "status": 409,
      },
      "completed": {
        "body": {
          "error": {
            "kind": "conflict",
            "message": "Only a failed or interrupted reply can be continued.",
          },
        },
        "status": 409,
      },
      "notLatest": {
        "body": {
          "error": {
            "kind": "conflict",
            "message": "Only the latest message can be continued.",
          },
        },
        "status": 409,
      },
    }
  `);
  expect(JSON.parse(hidePid(JSON.stringify(await chat.history(thread))))).toMatchInlineSnapshot(`
    [
      "user: fail",
      "assistant(failed other): hello from pid <pid>:",
      "user: fine",
      "assistant(completed): hello from pid <pid>: fine",
    ]
  `);
});
