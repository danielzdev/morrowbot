import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ReplyAttachment } from '@morrowbot/contracts';
import { afterEach, expect, it } from 'vitest';
import { startChatFixture } from '../../../host/src/testing/chat-fixture.ts';
import { serveReplyFile } from '../main/reply-files.ts';
import { createChatHub, replyFiles, type ThreadScreen } from '../renderer/features/chat/index.ts';
import { createApi } from '../renderer/shared/api.ts';
import { loaded } from './screens.ts';
import { openTestWindow } from './test-window.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1');
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(12)]);

const LONG = `${'a'.repeat(251)}.pdf`;
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

const attachmentsOf = (screen: ThreadScreen): readonly ReplyAttachment[] => {
  if (screen.view.kind !== 'loaded') return [];
  const reply = screen.view.value.messages.at(-1);
  return reply?.kind === 'assistant' ? reply.attachments : [];
};

it('a reply shows the files its agent attached, the window loads them through main without the token, and opens or saves them', async () => {
  const dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-reply-files-')));
  cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
  let chat = await startChatFixture({ dataDir });
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  const ws = agent.workspace.dir;
  await Promise.all([writeFile(path.join(ws, 'chart.png'), PNG), writeFile(path.join(ws, 'report.pdf'), PDF), writeFile(path.join(ws, 'demo.mp4'), MP4), writeFile(path.join(ws, 'run.command'), Buffer.concat([PNG, Buffer.from([1])])), writeFile(path.join(ws, 'tool.bin'), 'x'), writeFile(path.join(ws, LONG), Buffer.concat([PDF, Buffer.from('long')]))]);
  const paths = ['chart.png', 'report.pdf', 'demo.mp4', 'run.command', 'tool.bin', LONG].map((name) => path.join(ws, name));
  await chat.send(thread, `host-tool attach_files ${JSON.stringify({ paths })}`);
  await chat.close();
  chat = await startChatFixture({ dataDir });
  cleanup.push(() => chat.close());

  const target = { url: chat.host.url, token: chat.host.host.token };
  const saved = path.join(dataDir, 'Saved report.pdf');
  const window = openTestWindow(target, { openDir: path.join(dataDir, 'opened'), saveTo: (name) => (name === 'report.pdf' ? saved : name === LONG ? path.join(dataDir, LONG) : null) });
  const hub = createChatHub({ api: createApi(window.bridge), bridge: window.bridge });
  cleanup.push(() => {
    hub.close();
    window.close();
  });
  const attachments = attachmentsOf(await loaded(hub.session(thread.id)));
  const [image, pdf, video, renamed, unknown, long] = attachments;
  if (image === undefined || pdf === undefined || video === undefined || renamed === undefined || unknown === undefined || long === undefined) throw new Error('missing attachments');

  const files = replyFiles(window.bridge);
  const load = async (id: string, headers: Record<string, string> = {}) => {
    const response = await serveReplyFile(new Request(files.url(id), { headers }), target);
    return { status: response.status, type: response.headers.get('content-type'), range: response.headers.get('content-range'), bytes: Buffer.from(await response.arrayBuffer()) };
  };
  const shownImage = await load(image.id);
  const seek = await load(video.id, { range: 'bytes=4-11' });
  const actions = {
    openPdf: await files.act('open', pdf),
    openRenamed: await files.act('open', renamed),
    openUnknown: await files.act('open', unknown),
    savePdf: await files.act('save', pdf),
    saveCancelled: await files.act('save', image),
    openLongName: await files.act('open', long),
    saveLongName: await files.act('save', long),
  };
  const opened = path.join(dataDir, 'opened');
  expect({
    kinds: attachments.map(({ name, kind, mimeType }) => `${name === LONG ? '<255-byte name>' : name}: ${kind} ${mimeType}`),
    image: { ...shownImage, bytes: shownImage.bytes.equals(PNG) },
    seek: { ...seek, bytes: seek.bytes.toString('latin1') },
    otherScheme: (await serveReplyFile(new Request('https://example.com/reply/x'), target)).status,
    noHost: (await serveReplyFile(new Request(files.url(image.id)), undefined)).status,
    actions,
    opened: { pdf: await readdir(path.join(opened, pdf.id)), renamed: await readdir(path.join(opened, renamed.id)) },
    savedIsThePdf: (await readFile(saved)).equals(PDF),
    leftBehind: (await readdir(dataDir)).filter((name) => name.endsWith('.part')),
    tokenReachedRenderer: window.received().includes(target.token),
  }).toMatchInlineSnapshot(`
    {
      "actions": {
        "openLongName": {
          "kind": "opened",
        },
        "openPdf": {
          "kind": "opened",
        },
        "openRenamed": {
          "kind": "opened",
        },
        "openUnknown": {
          "kind": "failed",
          "reason": "Save this file to open it.",
        },
        "saveCancelled": {
          "kind": "cancelled",
        },
        "saveLongName": {
          "kind": "saved",
        },
        "savePdf": {
          "kind": "saved",
        },
      },
      "image": {
        "bytes": true,
        "range": null,
        "status": 200,
        "type": "image/png",
      },
      "kinds": [
        "chart.png: image image/png",
        "report.pdf: file application/pdf",
        "demo.mp4: video video/mp4",
        "run.command: image image/png",
        "tool.bin: file application/octet-stream",
        "<255-byte name>: file application/pdf",
      ],
      "leftBehind": [],
      "noHost": 503,
      "opened": {
        "pdf": [
          "report.pdf",
        ],
        "renamed": [
          "run.command.png",
        ],
      },
      "otherScheme": 404,
      "savedIsThePdf": true,
      "seek": {
        "bytes": "ftypisom",
        "range": "bytes 4-11/24",
        "status": 206,
        "type": "video/mp4",
      },
      "tokenReachedRenderer": false,
    }
  `);
});
