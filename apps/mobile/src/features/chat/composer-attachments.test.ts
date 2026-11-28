import type { Attachment, UploadAttachmentRequest } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import type { ChatResult } from '../../lib/chat-host.ts';
import { openChatSession } from './chat-session.ts';
import { attachmentTray, roomLeft, sendableIds, type ComposerAttachment, type Pick, type PickedFile } from './composer-attachments.ts';
import { composerButtons } from './composer-controls.ts';
import { createSampleChatHost } from './sample-host.ts';
import { scripted, state } from './session.test-support.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** An upload port whose replies the test gives, in order, once it says so. */
function uploads() {
  const waiting: { readonly request: UploadAttachmentRequest; readonly reply: (result: ChatResult<Attachment>) => void }[] = [];
  let ids = 0;
  return {
    upload: (request: UploadAttachmentRequest) =>
      new Promise<ChatResult<Attachment>>((resolve) => {
        waiting.push({ request, reply: resolve });
      }),
    saved: async () => {
      const next = waiting.shift();
      next?.reply({ kind: 'ok', value: { kind: 'text', id: `f${String(++ids)}`, name: next.request.name, size: 3 } });
      await settle();
    },
    unreachable: async () => {
      waiting.shift()?.reply({ kind: 'failed', status: 0, error: { kind: 'internal', message: 'Could not reach the host.' } });
      await settle();
    },
  };
}

/** Picks whose reads record how many run at once. */
function picker() {
  let reading = 0;
  let most = 0;
  const pick = (name: string, file: PickedFile = { kind: 'upload', request: { kind: 'text', name, text: 'abc' }, preview: null }): Pick => ({
    kind: 'file',
    name,
    preview: null,
    read: async () => {
      reading += 1;
      most = Math.max(most, reading);
      await settle();
      reading -= 1;
      return file;
    },
  });
  return { pick, most: () => most };
}

function trayWith(port: ReturnType<typeof uploads>) {
  let items: readonly ComposerAttachment[] = [];
  const tray = attachmentTray(port.upload, { get: () => items, set: (next) => (items = next) });
  const nameOf = (item: ComposerAttachment): string => {
    switch (item.kind) {
      case 'picking':
        return '(picker)';
      case 'ready':
        return item.attachment.name;
      case 'failed':
        return item.request.name;
      case 'preparing':
      case 'uploading':
      case 'refused':
        return item.name;
    }
  };
  const tiles = () => items.map((item) => `${nameOf(item)}: ${item.kind === 'ready' ? `ready ${item.attachment.id}` : item.kind}`);
  return { tray, items: () => items, tiles };
}

it('shows a tile per pick at once, reads one file at a time, and refuses picks past eight before reading them', async () => {
  const port = uploads();
  const { tray, items, tiles } = trayWith(port);
  const { pick, most } = picker();
  tray.add([
    pick('a.md'),
    { kind: 'refused', name: 'report.pdf', reason: 'Only photos and text files can be attached.' },
    pick('big.txt', { kind: 'refused', name: 'big.txt', reason: 'Text files can be up to 256 KB.' }),
  ]);
  tray.add(['b', 'c', 'd', 'e', 'f', 'g', 'h'].map((name) => pick(`${name}.md`)));
  const picked = { tiles: tiles(), sendable: sendableIds(items()), room: roomLeft(items()) };
  for (let step = 0; step < 20; step += 1) await settle();
  for (let done = 0; done < 7; done += 1) await port.saved();
  expect({ picked, after: tiles(), readsAtOnce: most(), sendable: sendableIds(items()) }).toEqual({
    picked: {
      tiles: ['a.md: preparing', 'report.pdf: refused', 'big.txt: preparing', 'b.md: preparing', 'c.md: preparing', 'd.md: preparing', 'e.md: preparing', 'f.md: preparing', 'g.md: preparing', 'h.md: refused'],
      sendable: null,
      room: 0,
    },
    after: ['a.md: ready f1', 'report.pdf: refused', 'big.txt: refused', 'b.md: ready f2', 'c.md: ready f3', 'd.md: ready f4', 'e.md: ready f5', 'f.md: ready f6', 'g.md: ready f7', 'h.md: refused'],
    readsAtOnce: 1,
    sendable: null,
  });
});

it('keeps a failed upload to retry, and forgets a file removed before its read or while it uploads', async () => {
  const port = uploads();
  const { tray, items, tiles } = trayWith(port);
  const { pick } = picker();
  tray.add([pick('notes.md'), pick('draft.md'), pick('photo.jpg')]);
  tray.remove(items()[2]?.key ?? 0);
  await settle();
  await settle();
  await port.unreachable();
  await settle();
  await settle();
  const failed = { tiles: tiles(), sendable: sendableIds(items()) };
  tray.remove(items()[1]?.key ?? 0);
  await port.saved();
  const afterRemoved = tiles();
  tray.retry(items()[0]?.key ?? 0);
  const retrying = tiles();
  await port.saved();
  expect({ failed, afterRemoved, retrying, after: tiles(), sendable: sendableIds(items()) }).toEqual({
    failed: { tiles: ['notes.md: failed', 'draft.md: uploading'], sendable: null },
    afterRemoved: ['notes.md: failed'],
    retrying: ['notes.md: uploading'],
    after: ['notes.md: ready f2'],
    sendable: ['f2'],
  });
});

it('holds Send from opening a picker until its picks arrive, drops nothing on cancel, and keeps reading after a read throws', async () => {
  const port = uploads();
  const { tray, items, tiles } = trayWith(port);
  const { pick } = picker();
  let hand: (picks: readonly Pick[]) => void = () => undefined;
  const opened = tray.pickFrom(() => new Promise((resolve) => (hand = resolve)));
  const whilePicking = { tiles: tiles(), sendable: sendableIds(items()) };
  const broken: Pick = { kind: 'file', name: 'broken.md', preview: null, read: () => { throw new Error('gone'); } };
  hand([broken, pick('next.md')]);
  await opened;
  for (let step = 0; step < 6; step += 1) await settle();
  await tray.pickFrom(() => Promise.resolve([]));
  const failedOpen = await tray.pickFrom(() => Promise.reject(new Error('denied'))).then(() => 'opened', () => 'rejected');
  expect({ whilePicking, after: tiles(), failedOpen }).toEqual({
    whilePicking: { tiles: ['(picker): picking'], sendable: null },
    after: ['broken.md: refused', 'next.md: uploading'],
    failedOpen: 'rejected',
  });
});

it('enables Send only once every tile is uploaded, then sends the files with no words and clears their tiles', async () => {
  const sample = createSampleChatHost();
  const gates: (() => void)[] = [];
  const session = openChatSession(
    {
      ...sample,
      uploadAttachment: async (threadId, request) => {
        await new Promise<void>((resolve) => gates.push(resolve));
        return request.name === 'offline.md'
          ? { kind: 'failed', status: 0, error: { kind: 'internal', message: 'Could not reach the host.' } }
          : sample.uploadAttachment(threadId, request);
      },
    },
    'errand-budget',
  );
  session.load();
  await settle();
  const { pick } = picker();
  const button = () => composerButtons(session.screen.get()).send?.enabled ?? false;
  session.attachments.add([pick('list.md'), pick('offline.md')]);
  const preparing = button();
  await session.send();
  for (let step = 0; step < 6; step += 1) await settle();
  for (const open of gates.splice(0)) open();
  await settle();
  const oneFailed = { enabled: button(), tiles: session.screen.get().attachments.map((item) => item.kind) };
  session.attachments.remove(session.screen.get().attachments[1]?.key ?? 0);
  const failedRemoved = button();
  await session.send();
  const { view, attachments } = session.screen.get();
  session.close();
  const user = view.kind === 'loaded' ? view.value.messages.findLast((message) => message.kind === 'user') : undefined;
  expect({ preparing, oneFailed, failedRemoved, sent: user?.kind === 'user' ? { text: user.text, files: user.attachments.map(({ name }) => name) } : null, left: attachments }).toEqual({
    preparing: false,
    oneFailed: { enabled: false, tiles: ['ready', 'failed'] },
    failedRemoved: true,
    sent: { text: '', files: ['list.md'] },
    left: [],
  });
});

it('waits with Queue while a file uploads, and keeps the words and file when the host takes files only once the reply ends', async () => {
  let saved: (result: ChatResult<Attachment>) => void = () => undefined;
  const { host, sent } = scripted([state(1, true, false)], {
    uploadAttachment: () => new Promise((resolve) => (saved = resolve)),
    send: (_threadId, text) => {
      sent.push(text);
      return Promise.resolve({ kind: 'failed', status: 409, error: { kind: 'conflict', message: 'Files can be sent once this reply ends. Send the text alone to queue it.' } });
    },
  });
  const session = openChatSession(host, 't');
  session.load();
  session.setDraft('Also this');
  session.attachments.add([picker().pick('list.md')]);
  for (let step = 0; step < 4; step += 1) await settle();
  const uploading = composerButtons(session.screen.get()).send;
  saved({ kind: 'ok', value: { kind: 'text', id: 'f1', name: 'list.md', size: 3 } });
  await settle();
  const uploaded = composerButtons(session.screen.get()).send;
  await session.send();
  const { draft, attachments, problem } = session.screen.get();
  expect({ uploading, uploaded, sent, draft, tiles: attachments.map(({ kind }) => kind), problem: problem?.message }).toEqual({
    uploading: { kind: 'queue', enabled: false },
    uploaded: { kind: 'queue', enabled: true },
    sent: ['Also this'],
    draft: 'Also this',
    tiles: ['ready'],
    problem: 'Files can be sent once this reply ends. Send the text alone to queue it.',
  });
});
