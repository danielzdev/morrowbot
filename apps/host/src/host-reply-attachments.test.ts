import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MessageList, replyAttachmentPath, ThreadState, type Agent, type AssistantMessage, type Thread } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';
import { startMemberKit } from './testing/member-kit.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(12)]);

let dataDir: string;
let chat: ChatFixture | undefined;
beforeEach(async () => {
  dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-reply-files-')));
});
afterEach(async () => {
  await chat?.close();
  expect(chat?.host.errors ?? []).toEqual([]);
  chat = undefined;
  await rm(dataDir, { recursive: true, force: true });
});

/** Makes `attach_files` calls in one turn through the echo provider's real MCP client and returns the saved reply. */
async function attach(fixture: ChatFixture, thread: Thread, ...calls: readonly (readonly string[])[]): Promise<AssistantMessage> {
  await fixture.send(thread, calls.map((paths) => `host-tool attach_files ${JSON.stringify({ paths })}`).join('\n'));
  const reply = MessageList.parse((await fixture.host.call('GET', `/api/threads/${thread.id}/messages`)).body).messages.at(-1);
  if (reply?.kind !== 'assistant') throw new Error('no reply');
  return reply;
}

async function fetchFile(fixture: ChatFixture, id: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const response = await fetch(`${fixture.host.url}${replyAttachmentPath(id)}`, { headers: { authorization: `Bearer ${fixture.host.host.token}`, ...headers } });
  const kept = ['content-type', 'content-length', 'content-range', 'content-disposition', 'x-content-type-options'];
  return {
    status: response.status,
    headers: Object.fromEntries(kept.flatMap((name) => { const value = response.headers.get(name); return value === null ? [] : [[name, value]]; })),
    body: Buffer.from(await response.arrayBuffer()),
  };
}

const hide = (text: string, agent: Agent): string => text.replaceAll(agent.workspace.dir, '<workspace>').replaceAll(dataDir, '<data>');

it('attaches an image, a PDF and a video from the workspace, refuses every path outside it, and keeps the files across a restart', async () => {
  chat = await startChatFixture({ dataDir });
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  const ws = agent.workspace.dir;
  const outside = path.join(dataDir, 'outside');
  await mkdir(outside);
  await mkdir(path.join(ws, 'out'));
  await writeFile(path.join(outside, 'secret.txt'), 'not yours');
  await Promise.all([
    writeFile(path.join(ws, 'out', 'chart.png'), PNG),
    writeFile(path.join(ws, 'report.pdf'), PDF),
    writeFile(path.join(ws, 'demo.mp4'), MP4),
    writeFile(path.join(ws, 'notes.png'), 'plain text, not an image'),
    symlink(path.join(outside, 'secret.txt'), path.join(ws, 'escape.txt')),
    symlink(outside, path.join(ws, 'linked')),
    symlink(path.join(ws, 'report.pdf'), path.join(ws, 'latest.pdf')),
  ]);
  execFileSync('mkfifo', [path.join(ws, 'pipe')]);
  const reply = await attach(chat, thread, [
    path.join(ws, 'out', 'chart.png'),
    path.join(ws, 'report.pdf'),
    path.join(ws, 'demo.mp4'),
    path.join(ws, 'notes.png'),
    path.join(ws, 'latest.pdf'),
    path.join(ws, 'missing.pdf'),
    path.join(outside, 'secret.txt'),
    path.join(ws, 'escape.txt'),
  ]);
  const refusedMore = await attach(chat, thread, [path.join(ws, 'linked', 'secret.txt'), `${ws}/out/../../../outside/secret.txt`, 'report.pdf', path.join(ws, 'out'), path.join(ws, 'pipe')]);
  expect({ attachments: reply.attachments, text: hide(reply.text, agent) }).toMatchInlineSnapshot(`
    {
      "attachments": [
        {
          "id": "id-5",
          "kind": "image",
          "mimeType": "image/png",
          "name": "chart.png",
          "size": 16,
        },
        {
          "id": "id-6",
          "kind": "file",
          "mimeType": "application/pdf",
          "name": "report.pdf",
          "size": 50,
        },
        {
          "id": "id-7",
          "kind": "video",
          "mimeType": "video/mp4",
          "name": "demo.mp4",
          "size": 24,
        },
        {
          "id": "id-8",
          "kind": "file",
          "mimeType": "application/octet-stream",
          "name": "notes.png",
          "size": 24,
        },
      ],
      "text": "attach_files: {"attached":[{"name":"chart.png","kind":"image","mimeType":"image/png","size":16},{"name":"report.pdf","kind":"file","mimeType":"application/pdf","size":50},{"name":"demo.mp4","kind":"video","mimeType":"video/mp4","size":24},{"name":"notes.png","kind":"file","mimeType":"application/octet-stream","size":24}],"refused":[{"path":"<workspace>/missing.pdf","reason":"No file is at this path."},{"path":"<data>/outside/secret.txt","reason":"Only files inside your workspace folder can be attached (symlinks are followed)."},{"path":"<workspace>/escape.txt","reason":"Only files inside your workspace folder can be attached (symlinks are followed)."}]}",
    }
  `);
  expect({ attachments: refusedMore.attachments, text: hide(refusedMore.text, agent) }).toMatchInlineSnapshot(`
    {
      "attachments": [],
      "text": "attach_files: error <workspace>/linked/secret.txt: Only files inside your workspace folder can be attached (symlinks are followed).
    <workspace>/out/../../../outside/secret.txt: Only files inside your workspace folder can be attached (symlinks are followed).
    report.pdf: Give the absolute path of a file in your workspace folder.
    <workspace>/out: Only regular files can be attached.
    <workspace>/pipe: Only regular files can be attached.",
    }
  `);

  const [image, pdf, video] = reply.attachments;
  if (image === undefined || pdf === undefined || video === undefined) throw new Error('missing attachments');
  const whole = await fetchFile(chat, pdf.id);
  const part = await fetchFile(chat, video.id, { range: 'bytes=4-11' });
  expect({ whole: { ...whole, body: whole.body.equals(PDF) }, part: { ...part, body: part.body.toString('latin1') } }).toMatchInlineSnapshot(`
    {
      "part": {
        "body": "ftypisom",
        "headers": {
          "content-disposition": "inline; filename*=UTF-8''demo.mp4",
          "content-length": "8",
          "content-range": "bytes 4-11/24",
          "content-type": "video/mp4",
          "x-content-type-options": "nosniff",
        },
        "status": 206,
      },
      "whole": {
        "body": true,
        "headers": {
          "content-disposition": "inline; filename*=UTF-8''report.pdf",
          "content-length": "50",
          "content-type": "application/pdf",
          "x-content-type-options": "nosniff",
        },
        "status": 200,
      },
    }
  `);
  expect({
    noToken: (await fetch(`${chat.host.url}${replyAttachmentPath(image.id)}`)).status,
    unknown: (await fetchFile(chat, 'nope')).status,
    userUploadRoute: (await chat.host.call('GET', `/api/attachments/${image.id}`)).status,
    pastTheEnd: (await fetchFile(chat, image.id, { range: 'bytes=999-' })).status,
  }).toMatchInlineSnapshot(`
    {
      "noToken": 401,
      "pastTheEnd": 416,
      "unknown": 404,
      "userUploadRoute": 404,
    }
  `);

  const before = ThreadState.parse((await chat.host.call('GET', `/api/threads/${thread.id}/state`)).body).messages;
  await chat.close();
  chat = await startChatFixture({ dataDir });
  const after = ThreadState.parse((await chat.host.call('GET', `/api/threads/${thread.id}/state`)).body).messages;
  expect(after).toEqual(before);
  expect((await fetchFile(chat, image.id)).body.equals(PNG)).toBe(true);

  await chat.host.call('DELETE', `/api/threads/${thread.id}`);
  await vi.waitFor(async () => {
    expect(await readdir(path.join(dataDir, 'reply-attachments'))).toEqual([]);
  });
});

it('holds each reply to 8 files, 100 MB a file and 200 MB in all, and keeps one copy of a file attached twice', { timeout: 60_000 }, async () => {
  chat = await startChatFixture({ dataDir });
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  const ws = agent.workspace.dir;
  const small = Array.from({ length: 9 }, (_, index) => path.join(ws, `note-${String(index)}.txt`));
  await Promise.all(small.map((file, index) => writeFile(file, `note ${String(index)}`)));
  const many = await attach(chat, thread, [small[0] ?? '', small[0] ?? '', ...small.slice(1, 6)], small.slice(6));

  const [big, bigger, huge] = ['big.bin', 'bigger.bin', 'huge.bin'].map((name) => path.join(ws, name));
  if (big === undefined || bigger === undefined || huge === undefined) throw new Error('unreachable');
  await writeFile(big, 'a');
  await writeFile(bigger, 'b');
  await truncate(big, 100 * 1024 * 1024);
  await truncate(bigger, 100 * 1024 * 1024);
  await writeFile(huge, '');
  await truncate(huge, 100 * 1024 * 1024 + 1);
  const heavy = await attach(chat, thread, [huge, big, bigger, small[0] ?? '']);
  expect({
    many: { names: many.attachments.map(({ name }) => name), text: hide(many.text, agent) },
    heavy: { sizes: heavy.attachments.map(({ name, size }) => `${name} ${String(size)}`), text: hide(heavy.text, agent) },
  }).toMatchInlineSnapshot(`
    {
      "heavy": {
        "sizes": [
          "big.bin 104857600",
          "bigger.bin 104857600",
        ],
        "text": "attach_files: {"attached":[{"name":"big.bin","kind":"file","mimeType":"application/octet-stream","size":104857600},{"name":"bigger.bin","kind":"file","mimeType":"application/octet-stream","size":104857600}],"refused":[{"path":"<workspace>/huge.bin","reason":"Files can be up to 100 MB."},{"path":"<workspace>/note-0.txt","reason":"A reply's files can add up to 200 MB."}]}",
      },
      "many": {
        "names": [
          "note-0.txt",
          "note-1.txt",
          "note-2.txt",
          "note-3.txt",
          "note-4.txt",
          "note-5.txt",
          "note-6.txt",
          "note-7.txt",
        ],
        "text": "attach_files: {"attached":[{"name":"note-0.txt","kind":"file","mimeType":"text/plain","size":6},{"name":"note-1.txt","kind":"file","mimeType":"text/plain","size":6},{"name":"note-2.txt","kind":"file","mimeType":"text/plain","size":6},{"name":"note-3.txt","kind":"file","mimeType":"text/plain","size":6},{"name":"note-4.txt","kind":"file","mimeType":"text/plain","size":6},{"name":"note-5.txt","kind":"file","mimeType":"text/plain","size":6}],"refused":[]}
    attach_files: {"attached":[{"name":"note-6.txt","kind":"file","mimeType":"text/plain","size":6},{"name":"note-7.txt","kind":"file","mimeType":"text/plain","size":6}],"refused":[{"path":"<workspace>/note-8.txt","reason":"A reply can carry up to 8 files."}]}",
      },
    }
  `);
});

it('serves a reply file only to those who may view its chat', async () => {
  const kit = await startMemberKit();
  try {
    const shared = await kit.named('Shared');
    const own = await kit.named('Private');
    await writeFile(path.join(own.agent.workspace.dir, 'plan.pdf'), PDF);
    await kit.chat.send(own.thread, `host-tool attach_files ${JSON.stringify({ paths: [path.join(own.agent.workspace.dir, 'plan.pdf')] })}`);
    const reply = MessageList.parse((await kit.chat.host.call('GET', `/api/threads/${own.thread.id}/messages`)).body).messages.at(-1);
    const id = reply?.kind === 'assistant' ? reply.attachments[0]?.id : undefined;
    if (id === undefined) throw new Error('nothing attached');
    const guest = await kit.join('Guest', { kind: 'scoped', agents: [{ agentId: shared.agent.id, canEdit: false, workspace: 'read-only', interAgentAllowlist: [] }] });
    const viewer = await kit.join('Viewer', { kind: 'scoped', agents: [{ agentId: own.agent.id, canEdit: false, workspace: 'read-only', interAgentAllowlist: [] }] });
    const statusFor = async (token: string): Promise<number> => (await fetch(`${kit.chat.host.url}${replyAttachmentPath(id)}`, { headers: { authorization: `Bearer ${token}` } })).status;
    expect({ guest: await statusFor(guest.token), viewer: await statusFor(viewer.token) }).toEqual({ guest: 404, viewer: 200 });
    expect(kit.chat.host.errors).toEqual([]);
  } finally {
    await kit.close();
  }
});
