import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { StartedSend, ThreadSummaryList, type ThreadSummary } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hidePid, startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';

let chat: ChatFixture;
beforeEach(async () => {
  chat = await startChatFixture();
});
afterEach(async () => {
  await chat.close();
  expect(chat.host.errors).toEqual([]);
});

function brief({ thread, activity, lastMessage }: ThreadSummary): string {
  const last = lastMessage === null ? 'no messages' : `${lastMessage.kind}: ${hidePid(lastMessage.preview)}`;
  return `${thread.title} | ${activity.kind} | ${last} | updated ${thread.updatedAt}`;
}

async function listed(): Promise<string[]> {
  return ThreadSummaryList.parse((await chat.host.call('GET', '/api/threads')).body).threads.map(brief);
}

it('lists each thread with its activity and newest message, and sends thread.changed whenever one changes', async () => {
  const agent = await chat.agent();
  const quiet = await chat.thread(agent, 'Reading list');
  const thread = await chat.thread(agent, 'Groceries');
  const sent = await chat.host.call('POST', `/api/threads/${thread.id}/messages`, { text: 'gate', sessionChoice: { kind: 'auto' } });
  const { generationId } = StartedSend.parse(sent.body);
  await chat.events.until((event) => event.kind === 'generation.status' && event.generationId === generationId);
  const whileWorking = await listed();
  await mkdir(path.join(chat.dataDir, 'plugin-data', 'echo'), { recursive: true });
  await writeFile(path.join(chat.dataDir, 'plugin-data', 'echo', 'gate'), '');
  await chat.events.finished(generationId);
  await chat.send(thread, 'fail');
  await chat.host.call('PATCH', `/api/threads/${quiet.id}`, { title: 'Books' });
  await vi.waitFor(() => {
    expect(chat.events.changed.at(-1)?.thread.title).toBe('Books');
  });
  expect({ whileWorking, afterwards: await listed(), changed: chat.events.changed.map(brief) }).toMatchInlineSnapshot(`
    {
      "afterwards": [
        "Books | idle | no messages | updated 2026-01-01T00:00:09.000Z",
        "Groceries | failed | assistant: hello from pid <pid>: | updated 2026-01-01T00:00:08.000Z",
      ],
      "changed": [
        "Reading list | idle | no messages | updated 2026-01-01T00:00:01.000Z",
        "Groceries | idle | no messages | updated 2026-01-01T00:00:02.000Z",
        "Groceries | queued | user: gate | updated 2026-01-01T00:00:03.000Z",
        "Groceries | working | user: gate | updated 2026-01-01T00:00:03.000Z",
        "Groceries | idle | assistant: hello from pid <pid>: | updated 2026-01-01T00:00:05.000Z",
        "Groceries | queued | user: fail | updated 2026-01-01T00:00:06.000Z",
        "Groceries | working | user: fail | updated 2026-01-01T00:00:06.000Z",
        "Groceries | failed | assistant: hello from pid <pid>: | updated 2026-01-01T00:00:08.000Z",
        "Books | idle | no messages | updated 2026-01-01T00:00:09.000Z",
      ],
      "whileWorking": [
        "Groceries | working | user: gate | updated 2026-01-01T00:00:03.000Z",
        "Reading list | idle | no messages | updated 2026-01-01T00:00:01.000Z",
      ],
    }
  `);
});
