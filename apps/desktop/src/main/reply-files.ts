import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { replyAttachmentPath } from '@morrowbot/contracts';
import { z } from 'zod';
import { REPLY_FILE_SCHEME, type FileActionResult } from '../renderer/bridge.ts';
import { checkSender, IpcRefusedError, type HostTarget } from './ipc-proxy.ts';
import type { FromRenderer } from './shell-actions.ts';

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const PASSED_ON = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'x-content-type-options', 'content-security-policy'];

/** The host file an `oribot-file://reply/<id>` URL names, or undefined for any other URL. */
function idOf(url: string): string | undefined {
  const parsed = URL.parse(url);
  if (parsed?.protocol !== `${REPLY_FILE_SCHEME}:` || parsed.host !== 'reply') return undefined;
  const id = parsed.pathname.slice(1);
  return SAFE_ID.test(id) ? id : undefined;
}

/** The host's answer for one file, or undefined when the host cannot be reached. */
async function fetchFile(host: HostTarget, id: string, range: string | null, signal?: AbortSignal): Promise<Response | undefined> {
  const headers: Record<string, string> = { authorization: `Bearer ${host.token}` };
  if (range !== null) headers.range = range;
  return fetch(`${host.url}${replyAttachmentPath(id)}`, { headers, ...(signal === undefined ? {} : { signal }) }).catch(() => undefined);
}

/**
 * Answers the window's `oribot-file://reply/<id>` requests from the host, adding the token in main so the
 * renderer never holds it. `Range` is passed on, so videos stream and seek.
 */
export async function serveReplyFile(request: Request, host: HostTarget | undefined): Promise<Response> {
  if (request.method !== 'GET') return new Response(null, { status: 405 });
  const id = idOf(request.url);
  if (id === undefined) return new Response(null, { status: 404 });
  if (host === undefined) return new Response(null, { status: 503 });
  const upstream = await fetchFile(host, id, request.headers.get('range'), request.signal);
  if (upstream === undefined) return new Response(null, { status: 503 });
  if (!upstream.ok) await upstream.body?.cancel();
  const headers = new Headers();
  for (const name of PASSED_ON) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(upstream.ok ? upstream.body : null, { status: upstream.status, headers });
}

const FileName = z.string().min(1).max(255).regex(/^[^/\\\0]+$/).refine((name) => name !== '.' && name !== '..');
const FileActionInput = z.strictObject({ action: z.enum(['open', 'save']), id: z.string().regex(SAFE_ID), name: FileName });
export type FileAction = z.infer<typeof FileActionInput>;

/** Checks an IPC `file-action` message: an attachment id and the name to save it as. */
export function parseFileAction(options: FromRenderer): FileAction {
  checkSender(options.sender, options.rendererUrl);
  const parsed = FileActionInput.safeParse(options.input);
  if (!parsed.success) throw new IpcRefusedError('Malformed file action');
  return parsed.data;
}

/** The extension a viewer app opens each type by. A file of any other type is only saved, never opened. */
const VIEWER_EXTENSION: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'application/json': '.json',
};

/** `name` ending in the extension its checked type opens with, so a file named `x.command` never runs; at most 255 bytes. */
export function viewerName(name: string, extension: string): string {
  if (path.extname(name).toLowerCase() === extension && Buffer.byteLength(name) <= 255) return name;
  const characters = Array.from(new Intl.Segmenter().segment(name), ({ segment }) => segment);
  while (Buffer.byteLength(`${characters.join('')}${extension}`) > 255) characters.pop();
  return `${characters.join('')}${extension}`;
}

async function* chunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  for (;;) {
    const next = await reader.read();
    if (next.done) return;
    yield next.value;
  }
}

export interface FileActionDeps {
  readonly host: HostTarget | undefined;
  /** A private folder for files handed to a viewer app. */
  readonly openDir: () => Promise<string>;
  /** Asks where to save; null when the user cancels. */
  readonly saveTo: (name: string) => Promise<string | null>;
  readonly open: (file: string) => Promise<string>;
  readonly reveal: (file: string) => void;
}

const GONE: FileActionResult = { kind: 'failed', reason: 'This file is no longer on the server.' };

/** Downloads the file to a short temporary name beside `file`, then renames it, so a failed download never leaves a partial file there. */
async function download(response: Response, file: string): Promise<void> {
  if (response.body === null) throw new Error('Empty response');
  const part = path.join(path.dirname(file), `.oribot-${randomBytes(8).toString('hex')}.part`);
  try {
    await pipeline(chunks(response.body), createWriteStream(part, { flags: 'wx', mode: 0o600 }));
    await rename(part, file);
  } catch (error) {
    await unlink(part).catch(() => undefined);
    throw error;
  }
}

async function openFile(request: FileAction, host: HostTarget, deps: FileActionDeps): Promise<FileActionResult> {
  const upstream = await fetchFile(host, request.id, null);
  if (upstream === undefined) return { kind: 'failed', reason: 'Ori Bot is not connected to its server.' };
  if (!upstream.ok) {
    await upstream.body?.cancel();
    return GONE;
  }
  const extension = VIEWER_EXTENSION[upstream.headers.get('content-type') ?? ''];
  const dir = path.join(await deps.openDir(), request.id);
  const file = extension === undefined ? undefined : path.join(dir, viewerName(request.name, extension));
  if (file === undefined || (await stat(file).catch(() => undefined)) !== undefined) {
    await upstream.body?.cancel();
    if (file === undefined) return { kind: 'failed', reason: 'Save this file to open it.' };
  } else {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await download(upstream, file);
  }
  const problem = await deps.open(file);
  return problem === '' ? { kind: 'opened' } : { kind: 'failed', reason: problem };
}

async function saveFile(request: FileAction, host: HostTarget, deps: FileActionDeps): Promise<FileActionResult> {
  const file = await deps.saveTo(request.name);
  if (file === null) return { kind: 'cancelled' };
  const upstream = await fetchFile(host, request.id, null);
  if (upstream === undefined) return { kind: 'failed', reason: 'Ori Bot is not connected to its server.' };
  if (!upstream.ok) {
    await upstream.body?.cancel();
    return GONE;
  }
  await download(upstream, file);
  deps.reveal(file);
  return { kind: 'saved' };
}

/** Opens a reply file in its viewer app, or saves it where the user picks and shows it in Finder. */
export async function runFileAction(request: FileAction, deps: FileActionDeps): Promise<FileActionResult> {
  const { host } = deps;
  if (host === undefined) return { kind: 'failed', reason: 'Ori Bot is not connected to its server.' };
  try {
    switch (request.action) {
      case 'open':
        return await openFile(request, host, deps);
      case 'save':
        return await saveFile(request, host, deps);
    }
  } catch {
    return { kind: 'failed', reason: "Ori Bot couldn't write this file." };
  }
}
