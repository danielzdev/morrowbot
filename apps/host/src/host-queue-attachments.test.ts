import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Attachment, QueuedSend, StartedSend, ThreadState, type ChatEvent, type QueuedMessage, type Thread } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openStorage } from './features/storage/index.ts';
import { startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';

let dataDir: string;
let chat: ChatFixture | undefined;
beforeEach(async () => {
  dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'orikami-queue-att-')));
});
afterEach(async () => {
  await chat?.close();
  expect(chat?.host.errors ?? []).toEqual([]);
  chat = undefined;
  await rm(dataDir, { recursive: true, force: true });
});

const post = (fixture: ChatFixture, thread: Thread, text: string, attachmentIds: readonly string[] = []) =>
  fixture.host.call('POST', `/api/threads/${thread.id}/messages`, attachmentIds.length === 0 ? { text } : { text, attachmentIds });

async function start(fixture: ChatFixture, thread: Thread, text: string): Promise<string> {
  const { generationId } = StartedSend.parse((await post(fixture, thread, text)).body);
  await fixture.events.until((event) => event.kind === 'generation.delta' && event.generationId === generationId);
  return generationId;
}

async function queue(fixture: ChatFixture, thread: Thread, text: string, attachmentIds: readonly string[] = []): Promise<QueuedMessage> {
  return QueuedSend.parse((await post(fixture, thread, text, attachmentIds)).body).queued;
}

async function uploadText(fixture: ChatFixture, thread: Thread, name: string, text: string): Promise<Attachment> {
  return Attachment.parse((await fixture.host.call('POST', `/api/threads/${thread.id}/attachments`, { kind: 'text', name, text })).body);
}

async function state(fixture: ChatFixture, thread: Thread): Promise<ThreadState> {
  return ThreadState.parse((await fixture.host.call('GET', `/api/threads/${thread.id}/state`)).body);
}

async function delivered(fixture: ChatFixture, queuedId: string): Promise<void> {
  const startedBy = (event: ChatEvent): boolean => event.kind === 'generation.started' && event.userMessage?.id === queuedId;
  await fixture.events.until(startedBy);
  const started = fixture.events.received.find(startedBy);
  if (started?.kind === 'generation.started') await fixture.events.finished(started.generationId);
}

function queueChanges(fixture: ChatFixture): string[][] {
  return fixture.events.received.flatMap((event) =>
    event.kind === 'queue.changed' ? [event.queue.map((item) => `${item.text}: ${JSON.stringify(item.state)}`)] : [],
  );
}

async function openGate(): Promise<void> {
  await mkdir(path.join(dataDir, 'plugin-data', 'echo'), { recursive: true });
  await writeFile(path.join(dataDir, 'plugin-data', 'echo', 'gate'), '');
}

it('queues a message with attachments (including attachment-only) and delivers them into the next turn', async () => {
  chat = await startChatFixture({ dataDir });
  const thread = await chat.thread(await chat.agent());
  await start(chat, thread, 'gate');
  const note = await uploadText(chat, thread, 'notes.txt', 'release checklist');
  const queued = await queue(chat, thread, '', [note.id]);
  const duplicate = await post(chat, thread, 'reuse attempt', [note.id]);
  const during = await state(chat, thread);
  await openGate();
  await delivered(chat, queued.id);
  const after = await state(chat, thread);
  expect({
    queuedAttachments: queued.attachments.map(({ id, name }) => ({ id, name })),
    duplicateStatus: duplicate.status,
    duringAttachments: during.queue.map((entry) => entry.attachments.map(({ name }) => name)),
    deliveredUserMessage: after.messages.find((message) => message.id === queued.id),
    history: await chat.history(thread),
  }).toMatchInlineSnapshot(`
    {
      "deliveredUserMessage": {
        "attachments": [
          {
            "id": "id-5",
            "kind": "text",
            "name": "notes.txt",
            "size": 17,
          },
        ],
        "createdAt": "2026-01-01T00:00:07.000Z",
        "id": "id-6",
        "kind": "user",
        "text": "",
        "threadId": "id-2",
      },
      "duplicateStatus": 400,
      "duringAttachments": [
        [
          "notes.txt",
        ],
      ],
      "history": [
        "user: gate",
        "assistant(completed): hello from pid <pid>:",
        "user: ",
        "assistant(completed): hello from pid <pid>: <attached-file name="notes.txt">
    release checklist
    </attached-file>

    (No message: see the attached files.)",
      ],
      "queuedAttachments": [
        {
          "id": "id-5",
          "name": "notes.txt",
        },
      ],
    }
  `);
});

it('Steer now on a queued message with attachments (and attachment-only) uses interrupt-and-resume fallback even on a steerable provider', async () => {
  chat = await startChatFixture({ dataDir });
  const thread = await chat.thread(await chat.agent());
  await start(chat, thread, 'steerable');
  const spec = await uploadText(chat, thread, 'spec.txt', 'use tabs');
  const queued = await queue(chat, thread, '', [spec.id]);
  const steer = await chat.host.call('POST', `/api/threads/${thread.id}/queue/${queued.id}/steer`);
  await delivered(chat, queued.id);
  expect({
    steer: steer.status,
    queueChanges: queueChanges(chat),
    history: await chat.history(thread),
  }).toMatchInlineSnapshot(`
    {
      "history": [
        "user: steerable",
        "assistant(steered): hello from pid <pid>:",
        "user: ",
        "assistant(completed): hello from pid <pid>: <attached-file name="spec.txt">
    use tabs
    </attached-file>

    [The user interrupted your work with this message. Reply to it visibly first, and answer it if it is a question; then carry on with the task you were doing, with it taken into account.]

    (No message: see the attached files.)",
      ],
      "queueChanges": [
        [
          ": {"kind":"queued"}",
        ],
        [
          ": {"kind":"steering","via":"interrupt"}",
        ],
        [],
      ],
      "steer": 204,
    }
  `);
});

it('blocks idle sends from stealing a held queued message attachment and renews attachment expiry when cancelled for edit', async () => {
  let step = 0;
  const times = [
    '2026-01-01T00:00:00.000Z',
    '2026-01-01T00:00:01.000Z',
    '2026-01-01T00:00:02.000Z',
    '2026-01-01T00:00:03.000Z',
    '2026-01-01T00:00:04.000Z',
    '2026-01-01T00:00:05.000Z',
    '2026-01-01T00:00:06.000Z',
    '2026-01-01T00:00:07.000Z',
    '2026-01-01T00:00:08.000Z',
    '2026-01-03T00:00:00.000Z',
  ];
  let idCount = 0;
  chat = await startChatFixture({
    dataDir,
    sequence: {
      newId: () => `id-${String(++idCount)}`,
      now: () => times[Math.min(step++, times.length - 1)] ?? '2026-01-03T00:00:00.000Z',
    },
  });
  const thread = await chat.thread(await chat.agent());
  await start(chat, thread, 'stall-polite');
  const note = await uploadText(chat, thread, 'held.txt', 'keep safe');
  const held = await queue(chat, thread, 'wait for me', [note.id]);
  await chat.host.call('POST', `/api/threads/${thread.id}/stop`);
  // Advance clock past the 24h window before attempting steal and cancel
  step = times.length - 1;
  const stealAttempt = await post(chat, thread, 'steal', [note.id]);
  const cancel = await chat.host.call('DELETE', `/api/threads/${thread.id}/queue/${held.id}`);
  await chat.close();
  chat = undefined;

  const storage = openStorage(path.join(dataDir, 'orikami.sqlite'), () => '2026-01-03T00:00:00.000Z');
  try {
    const swept = storage.attachments.deleteUnsentBefore('2026-01-02T00:00:00.000Z');
    const stillPending = storage.attachments.pending(thread.id, [note.id]);
    expect({
      stealStatus: stealAttempt.status,
      cancelStatus: cancel.status,
      swept,
      stillPending: stillPending?.map(({ id }) => id),
    }).toMatchInlineSnapshot(`
      {
        "cancelStatus": 204,
        "stealStatus": 400,
        "stillPending": [
          "id-5",
        ],
        "swept": [],
      }
    `);
  } finally {
    storage.close();
  }
});
