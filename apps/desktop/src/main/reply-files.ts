import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { replyAttachmentPath } from '@morrowbot/contracts';
import { z } from 'zod';
import { REPLY_FILE_SCHEME, type FileActionResult } from '../renderer/bridge.ts';
import { checkSender, IpcRefusedError, type HostTarget } from './ipc-proxy.ts';
import type { FromRenderer } from './shell-actions.ts';

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const PASSED_ON = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'x-content-type-options', 'content-security-policy'];

/** The host file a `morrowbot-file://reply/<id>` URL names, or undefined for any other URL. */
function idOf(url: string): string | undefined {
  const parsed = URL.parse(url);
  if (parsed?.protocol !== `${REPLY_FILE_SCHEME}:` || parsed.host !== 'reply') return undefined;
  const id = decodeURIComponent(parsed.pathname.slice(1));
  return SAFE_ID.test(id) ? id : undefined;
}

async function fetchFile(host: HostTarget, id: string, range: string | null): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${host.token}` };
  if (range !== null) headers.range = range;
  return fetch(`${host.url}${replyAttachmentPath(id)}`, { headers });
}

/**
 * Answers the window's `morrowbot-file://reply/<id>` requests from the host, adding the token in main so the
 * renderer never holds it. `Range` is passed on, so videos stream and seek.
 */
export async function serveReplyFile(request: Request, host: HostTarget | undefined): Promise<Response> {
  if (request.method !== 'GET') return new Response(null, { status: 405 });
  const id = idOf(request.url);
  if (id === undefined) return new Response(null, { status: 404 });
  if (host === undefined) return new Response(null, { status: 503 });
  const upstream = await fetchFile(host, id, request.headers.get('range'));
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

/** `name` ending in the extension its checked type opens with, so a file named `x.command` never runs. */
export function viewerName(name: string, extension: string): string {
  return path.extname(name).toLowerCase() === extension ? name : `${name}${extension}`;
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
  readonly openDir: string;
  /** Asks where to save; null when the user cancels. */
  readonly saveTo: (name: string) => Promise<string | null>;
  readonly open: (file: string) => Promise<string>;
  readonly reveal: (file: string) => void;
}

/** Opens a reply file in its viewer app, or saves it where the user picks and shows it in Finder. */
export async function runFileAction(request: FileAction, deps: FileActionDeps): Promise<FileActionResult> {
  if (deps.host === undefined) return { kind: 'failed', reason: 'MorrowBot is not connected to its server.' };
  const upstream = await fetchFile(deps.host, request.id, null);
  if (!upstream.ok || upstream.body === null) return { kind: 'failed', reason: 'This file is no longer on the server.' };
  const type = upstream.headers.get('content-type') ?? '';
  const write = async (file: string): Promise<void> => {
    if (upstream.body === null) return;
    await pipeline(chunks(upstream.body), createWriteStream(file, { mode: 0o600 }));
  };
  switch (request.action) {
    case 'open': {
      const extension = VIEWER_EXTENSION[type];
      if (extension === undefined) {
        await upstream.body.cancel();
        return { kind: 'failed', reason: 'Save this file to open it.' };
      }
      const dir = path.join(deps.openDir, request.id);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const file = path.join(dir, viewerName(request.name, extension));
      await write(file);
      const problem = await deps.open(file);
      return problem === '' ? { kind: 'opened' } : { kind: 'failed', reason: problem };
    }
    case 'save': {
      const file = await deps.saveTo(request.name);
      if (file === null) {
        await upstream.body.cancel();
        return { kind: 'cancelled' };
      }
      await write(file);
      deps.reveal(file);
      return { kind: 'saved' };
    }
  }
}
