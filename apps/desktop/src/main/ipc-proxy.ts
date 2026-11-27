import { EventClientFrame } from '@morrowbot/contracts';
import { z } from 'zod';
import type { ApiReply } from '../renderer/bridge.ts';

/** Where the running host listens, and the per-launch token it accepts. Lives only in main's memory. */
export interface HostTarget {
  readonly url: string;
  readonly token: string;
}

/** Who sent an IPC message, as Electron reports it. */
export type IpcSender =
  | { readonly kind: 'missing-frame' }
  | { readonly kind: 'frame'; readonly url: string; readonly isMainFrame: boolean };

export class IpcRefusedError extends Error {
  override readonly name = 'IpcRefusedError';
}

const ApiRequest = z.strictObject({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string(),
  body: z.unknown().optional(),
});

const PATH_BASE = 'http://127.0.0.1';

/** Throws unless the message came from the main frame of our window showing exactly the app's renderer page. */
export function checkSender(sender: IpcSender, rendererUrl: string): void {
  switch (sender.kind) {
    case 'missing-frame':
      throw new IpcRefusedError('IPC sender has no frame');
    case 'frame':
      if (sender.url !== rendererUrl) throw new IpcRefusedError(`IPC sender is not the app page: ${sender.url}`);
      if (!sender.isMainFrame) throw new IpcRefusedError('IPC sender is not the main frame of the app window');
      return;
  }
}

/** The path and query to call on the host, or a refusal for anything outside `/api/`. */
function apiPath(path: string): string {
  const target = path.startsWith('/api/') ? URL.parse(path, PATH_BASE) : null;
  if (target?.origin !== PATH_BASE || !target.pathname.startsWith('/api/')) {
    throw new IpcRefusedError('Only /api/ paths are proxied');
  }
  return `${target.pathname}${target.search}`;
}

const HOST_DOWN: ApiReply = {
  status: 503,
  body: { error: { kind: 'internal', message: 'The MorrowBot host is not running' } },
};

/**
 * Checks an IPC `request` message and forwards it to the host with the Bearer token.
 * Only status and body come back, so the renderer never sees the token or any header.
 */
export async function proxyRequest(options: {
  readonly sender: IpcSender;
  readonly rendererUrl: string;
  readonly input: unknown;
  readonly host: HostTarget | undefined;
}): Promise<ApiReply> {
  checkSender(options.sender, options.rendererUrl);
  const parsed = ApiRequest.safeParse(options.input);
  if (!parsed.success) throw new IpcRefusedError('Malformed API request');
  const { method, body } = parsed.data;
  const path = apiPath(parsed.data.path);
  const { host } = options;
  if (host === undefined) return HOST_DOWN;
  let response: Response;
  try {
    response = await fetch(`${host.url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${host.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return HOST_DOWN;
  }
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : parseJson(text) };
}

/** Checks an IPC `subscribe` message: only the app page may follow a thread's events. */
export function parseSubscription(options: { readonly sender: IpcSender; readonly rendererUrl: string; readonly input: unknown }): EventClientFrame {
  checkSender(options.sender, options.rendererUrl);
  const parsed = EventClientFrame.safeParse(options.input);
  if (!parsed.success) throw new IpcRefusedError('Malformed subscription');
  return parsed.data;
}

/** Checks an IPC `copy-text` message: only the app page may write to the clipboard. */
export function parseCopyText(options: { readonly sender: IpcSender; readonly rendererUrl: string; readonly input: unknown }): string {
  checkSender(options.sender, options.rendererUrl);
  const parsed = z.string().max(100_000).safeParse(options.input);
  if (!parsed.success) throw new IpcRefusedError('Malformed clipboard text');
  return parsed.data;
}

function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return text;
  }
}
