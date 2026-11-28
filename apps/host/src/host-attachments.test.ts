import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { Attachment, MessageList, StartedSend } from '@morrowbot/contracts';
import { afterEach, expect, it } from 'vitest';
import { hidePid, startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';

/** The 8-byte PNG signature and an IHDR start: enough for the host's type check. */
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');

let chat: ChatFixture | undefined;
afterEach(async () => {
  await chat?.close();
  chat = undefined;
});

it('sends an uploaded image and text file with the message, and the provider gets both', async () => {
  chat = await startChatFixture();
  const thread = await chat.thread(await chat.agent());
  const upload = (body: unknown) => chat?.host.call('POST', `/api/threads/${thread.id}/attachments`, body);
  const image = Attachment.parse((await upload({ kind: 'image', name: 'screen shot.png', mimeType: 'image/png', data: PNG }))?.body);
  const notes = Attachment.parse((await upload({ kind: 'text', name: 'notes.md', text: '# Notes\nWater on Tuesdays.' }))?.body);
  const sent = await chat.host.call('POST', `/api/threads/${thread.id}/messages`, { text: 'describe-input', attachmentIds: [image.id, notes.id] });
  await chat.events.finished(StartedSend.parse(sent.body).generationId);
  const messages = MessageList.parse((await chat.host.call('GET', `/api/threads/${thread.id}/messages`)).body).messages;
  expect(messages.map((message) => ({ ...message, text: hidePid(message.text) }))).toMatchInlineSnapshot(`
    [
      {
        "attachments": [
          {
            "id": "id-3",
            "kind": "image",
            "mimeType": "image/png",
            "name": "screen shot.png",
            "size": 16,
          },
          {
            "id": "id-4",
            "kind": "text",
            "name": "notes.md",
            "size": 26,
          },
        ],
        "createdAt": "2026-01-01T00:00:04.000Z",
        "id": "id-6",
        "kind": "user",
        "text": "describe-input",
        "threadId": "id-2",
      },
      {
        "createdAt": "2026-01-01T00:00:06.000Z",
        "id": "id-7",
        "kind": "assistant",
        "outcome": {
          "finishReason": "stop",
          "kind": "completed",
        },
        "text": "hello from pid <pid>: {"prompt":"<attached-image name=\\"screen shot.png\\" />\\n\\n<attached-file name=\\"notes.md\\">\\n# Notes\\nWater on Tuesdays.\\n</attached-file>\\n\\ndescribe-input","images":[{"mimeType":"image/png","bytes":16}]}",
        "threadId": "id-2",
      },
    ]
  `);
  expect((await chat.host.call('GET', `/api/attachments/${image.id}`)).body).toEqual({ kind: 'image', mimeType: 'image/png', data: PNG });
  expect((await chat.host.call('GET', `/api/attachments/${notes.id}`)).body).toEqual({ kind: 'text', text: '# Notes\nWater on Tuesdays.' });
});

it('refuses a file that is not the image type it claims, and an attachment sent already', async () => {
  chat = await startChatFixture();
  const thread = await chat.thread(await chat.agent());
  const upload = (body: unknown) => chat?.host.call('POST', `/api/threads/${thread.id}/attachments`, body);
  const image = Attachment.parse((await upload({ kind: 'image', name: 'a.png', mimeType: 'image/png', data: PNG }))?.body);
  await chat.events.finished(
    StartedSend.parse((await chat.host.call('POST', `/api/threads/${thread.id}/messages`, { text: '', attachmentIds: [image.id] })).body).generationId,
  );
  expect({
    disguised: (await upload({ kind: 'image', name: 'b.jpg', mimeType: 'image/jpeg', data: PNG }))?.body,
    resent: (await chat.host.call('POST', `/api/threads/${thread.id}/messages`, { text: 'again', attachmentIds: [image.id] })).body,
    empty: (await chat.host.call('POST', `/api/threads/${thread.id}/messages`, { text: '  ' })).body,
    history: await chat.history(thread),
  }).toMatchInlineSnapshot(`
    {
      "disguised": {
        "error": {
          "kind": "invalid_request",
          "message": "The file is not the image type it says it is.",
        },
      },
      "empty": {
        "error": {
          "kind": "invalid_request",
          "message": "(body): Write a message or attach a file",
        },
      },
      "history": [
        "user: ",
        "assistant(completed): hello from pid <pid>: <attached-image name="a.png" />

    (No message: see the attached files.)",
      ],
      "resent": {
        "error": {
          "kind": "invalid_request",
          "message": "An attached file is no longer there. Remove it and attach it again.",
        },
      },
    }
  `);
});

it('removes the files of a deleted chat', async () => {
  chat = await startChatFixture();
  const thread = await chat.thread(await chat.agent());
  await chat.host.call('POST', `/api/threads/${thread.id}/attachments`, { kind: 'text', name: 'a.txt', text: 'kept until the chat goes' });
  const dir = path.join(chat.dataDir, 'attachments');
  expect(await readdir(dir)).toHaveLength(1);
  await chat.host.call('DELETE', `/api/threads/${thread.id}`);
  await expect.poll(() => readdir(dir)).toEqual([]);
});
