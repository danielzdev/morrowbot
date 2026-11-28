import { afterEach, expect, it } from 'vitest';
import type { ThreadEvent } from '../../lib/host-connection.ts';
import { connectHost } from './host-transport.ts';
import { createLiveChatHost } from './live-chat-host.ts';
import { echoThread, pair, realSockets, startRealHost, until } from './real-host.test-support.ts';

/** The 8-byte PNG signature and an IHDR start: enough for the host's type check. */
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function pairedChat() {
  const host = await startRealHost();
  cleanup.push(host.close);
  const deps = { fetch, openSocket: realSockets([]).open, delayFor: () => 60_000, now: () => 0, report: () => undefined };
  const live = connectHost(await pair(host), deps, () => undefined);
  cleanup.push(live.close);
  const chat = createLiveChatHost(live.transport);
  const thread = await echoThread(host);
  const events: ThreadEvent[] = [];
  let fresh = false;
  cleanup.push(
    chat.watch(thread.id, {
      onFresh: () => {
        fresh = true;
      },
      onEvent: (event) => events.push(event),
      onStale: () => undefined,
      onGone: () => undefined,
    }),
  );
  await until(() => fresh);
  return { chat, thread, events };
}

it('uploads a photo and a text file, and a send with their ids reaches the provider with both', async () => {
  const { chat, thread, events } = await pairedChat();
  const photo = await chat.uploadAttachment(thread.id, { kind: 'image', name: 'IMG_0001.jpg', mimeType: 'image/png', data: PNG });
  const notes = await chat.uploadAttachment(thread.id, { kind: 'text', name: 'list.md', text: '- milk\n- eggs' });
  const ids = [photo, notes].flatMap((result) => (result.kind === 'ok' ? [result.value.id] : []));
  const sent = await chat.send(thread.id, '', ids);
  await until(() => events.some(({ kind }) => kind === 'generation.finished'));
  const started = events.find((event) => event.kind === 'generation.started');
  const finished = events.find((event) => event.kind === 'generation.finished');
  expect({
    sent: sent.kind === 'ok' ? sent.value.kind : sent,
    userMessage: started?.kind === 'generation.started' ? started.userMessage?.attachments.map(({ kind, name, size }) => ({ kind, name, size })) : null,
    providerSaw: finished?.kind === 'generation.finished' ? /attached-image name=\\?"IMG_0001.jpg/.test(finished.message.text) && finished.message.text.includes('- milk') : false,
  }).toEqual({
    sent: 'started',
    userMessage: [
      { kind: 'image', name: 'IMG_0001.jpg', size: 16 },
      { kind: 'text', name: 'list.md', size: 13 },
    ],
    providerSaw: true,
  });
});

it("shows the host's reason when it refuses an upload, or a send naming a file already sent", async () => {
  const { chat, thread, events } = await pairedChat();
  const disguised = await chat.uploadAttachment(thread.id, { kind: 'image', name: 'photo.jpg', mimeType: 'image/jpeg', data: PNG });
  const notes = await chat.uploadAttachment(thread.id, { kind: 'text', name: 'a.md', text: 'hi' });
  const id = notes.kind === 'ok' ? notes.value.id : 'none';
  await chat.send(thread.id, 'first', [id]);
  await until(() => events.some(({ kind }) => kind === 'generation.finished'));
  const resent = await chat.send(thread.id, 'again', [id]);
  const missingThread = await chat.uploadAttachment('no-such-thread', { kind: 'text', name: 'a.md', text: 'hi' });
  const failure = (result: typeof disguised | typeof resent) => (result.kind === 'failed' ? { status: result.status, message: result.error.message } : result.kind);
  expect({ disguised: failure(disguised), resent: failure(resent), missingThread: failure(missingThread) }).toMatchInlineSnapshot(`
    {
      "disguised": {
        "message": "The file is not the image type it says it is.",
        "status": 400,
      },
      "missingThread": {
        "message": "Thread not found",
        "status": 404,
      },
      "resent": {
        "message": "An attached file is no longer there. Remove it and attach it again.",
        "status": 400,
      },
    }
  `);
});
