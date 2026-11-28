import type { Attachment, UploadAttachmentRequest } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import type { ChatResult } from '../../lib/chat-host.ts';
import { composerButton, openChatSession } from './chat-session.ts';
import { attachmentTray, roomLeft, sendableIds, type ComposerAttachment, type PickedFile } from './composer-attachments.ts';
import { createSampleChatHost } from './sample-host.ts';

/** An upload port whose replies the test gives, in order, once it says so. */
function uploads() {
  const waiting: { readonly request: UploadAttachmentRequest; readonly reply: (result: ChatResult<Attachment>) => void }[] = [];
  let ids = 0;
  return {
    upload: (request: UploadAttachmentRequest) =>
      new Promise<ChatResult<Attachment>>((resolve) => {
        waiting.push({ request, reply: resolve });
      }),
    names: () => waiting.map(({ request }) => request.name),
    saved: async () => {
      const next = waiting.shift();
      const id = `f${String(++ids)}`;
      next?.reply({ kind: 'ok', value: { kind: 'text', id, name: next.request.name, size: 3 } });
      await Promise.resolve();
    },
    unreachable: async () => {
      waiting.shift()?.reply({ kind: 'failed', status: 0, error: { kind: 'internal', message: 'Could not reach the host. Network request failed' } });
      await Promise.resolve();
    },
  };
}

const text = (name: string): PickedFile => ({ kind: 'upload', request: { kind: 'text', name, text: 'abc' }, preview: null });

function trayWith(port: ReturnType<typeof uploads>) {
  let items: readonly ComposerAttachment[] = [];
  const tray = attachmentTray(port.upload, { get: () => items, set: (next) => (items = next) });
  const tiles = () => items.map((item) => (item.kind === 'ready' ? `${item.attachment.name}: ready ${item.attachment.id}` : `${item.kind === 'failed' ? item.request.name : item.name}: ${item.kind}`));
  return { tray, items: () => items, tiles };
}

it('uploads each picked file, shows refused ones, and turns files past eight into refused tiles', async () => {
  const port = uploads();
  const { tray, items, tiles } = trayWith(port);
  tray.add([text('a.md'), { kind: 'refused', name: 'big.txt', reason: 'Text files can be up to 256 KB.' }]);
  tray.add(['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((name) => text(`${name}.md`)));
  const whileUploading = { tiles: tiles(), sendable: sendableIds(items()), room: roomLeft(items()), uploading: port.names().length };
  for (let done = 0; done < 8; done += 1) await port.saved();
  expect({ whileUploading, after: tiles(), sendable: sendableIds(items()) }).toEqual({
    whileUploading: {
      tiles: ['a.md: uploading', 'big.txt: refused', 'b.md: uploading', 'c.md: uploading', 'd.md: uploading', 'e.md: uploading', 'f.md: uploading', 'g.md: uploading', 'h.md: uploading', 'i.md: refused'],
      sendable: null,
      room: 0,
      uploading: 8,
    },
    after: ['a.md: ready f1', 'big.txt: refused', 'b.md: ready f2', 'c.md: ready f3', 'd.md: ready f4', 'e.md: ready f5', 'f.md: ready f6', 'g.md: ready f7', 'h.md: ready f8', 'i.md: refused'],
    sendable: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'],
  });
});

it('keeps a failed upload to retry, and forgets one removed while it was still uploading', async () => {
  const port = uploads();
  const { tray, items, tiles } = trayWith(port);
  tray.add([text('notes.md'), text('draft.md')]);
  await port.unreachable();
  const failed = tiles();
  const draftKey = items()[1]?.key ?? 0;
  tray.remove(draftKey);
  await port.saved();
  const afterRemoved = tiles();
  tray.retry(items()[0]?.key ?? 0);
  const retrying = tiles();
  await port.saved();
  expect({ failed, afterRemoved, retrying, after: tiles(), sendable: sendableIds(items()) }).toEqual({
    failed: ['notes.md: failed', 'draft.md: uploading'],
    afterRemoved: ['notes.md: failed'],
    retrying: ['notes.md: uploading'],
    after: ['notes.md: ready f2'],
    sendable: ['f2'],
  });
});

it('waits for uploads before Send, sends the uploaded ids even with no words, and clears only their tiles', async () => {
  const port = uploads();
  const sends: { readonly text: string; readonly attachmentIds: readonly string[] }[] = [];
  const sample = createSampleChatHost();
  const session = openChatSession(
    {
      ...sample,
      uploadAttachment: (_threadId, request) => port.upload(request),
      send: (threadId, words, attachmentIds) => {
        sends.push({ text: words, attachmentIds });
        return sample.send(threadId, words, []);
      },
    },
    'errand-budget',
  );
  session.load();
  await Promise.resolve();
  const button = () => composerButton(session.screen.get());
  session.attachments.add([text('list.md'), { kind: 'refused', name: 'clip.mov', reason: 'Only photos and text files can be attached.' }]);
  const uploading = button();
  await session.send();
  await port.saved();
  const uploaded = button();
  await session.send();
  session.close();
  expect({ uploading, uploaded, sends, left: session.screen.get().attachments.map((item) => item.kind) }).toEqual({
    uploading: { kind: 'send', enabled: false },
    uploaded: { kind: 'send', enabled: true },
    sends: [{ text: '', attachmentIds: ['f1'] }],
    left: ['refused'],
  });
});
