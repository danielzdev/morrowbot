import { ApiError, lenient } from '@morrowbot/contracts';
import type { HostRequest, HostResult, UiCapability } from '../../lib/host-connection.ts';

/** The part of `fetch` the host client uses, so tests and the app pass their own. */
export type HttpFetch = (
  url: string,
  init: { readonly method: string; readonly headers: Record<string, string>; readonly body?: string; readonly signal: AbortSignal },
) => Promise<{ readonly status: number; readonly text: () => Promise<string> }>;

export interface HttpTarget {
  /** The host's origin (a `HostUrl`), with no trailing slash. */
  readonly url: string;
  /** Null only for the pairing claim. */
  readonly token: string | null;
  readonly fetch: HttpFetch;
  readonly ui: () => UiCapability;
}

/** The UI-blocks version this app renders; the host tailors `/api/ui/v1` replies to it. */
export const UI_BLOCKS_VERSION = '0.0';
const UI_PREFIX = '/api/ui/v1/';
const UI_PROBE = '/api/ui/v1/capabilities';
const TIMEOUT_MS = 10_000;
const ApiErrorReply = lenient(ApiError);

/** Sends one request to the host and parses the reply at this boundary. Never throws. */
export async function sendRequest<T>(target: HttpTarget, request: HostRequest<T>): Promise<HostResult<T>> {
  if (request.path.startsWith(UI_PREFIX) && request.path !== UI_PROBE && target.ui().kind !== 'available') {
    return { kind: 'unsupported' };
  }
  const headers: Record<string, string> = { accept: 'application/json', 'x-morrow-ui-blocks': UI_BLOCKS_VERSION };
  if (target.token !== null) headers.authorization = `Bearer ${target.token}`;
  if (request.body !== undefined) headers['content-type'] = 'application/json';
  const abort = new AbortController();
  const timer = setTimeout(() => {
    abort.abort();
  }, TIMEOUT_MS);
  try {
    const response = await target.fetch(`${target.url}${request.path}`, {
      method: request.method,
      headers,
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      signal: abort.signal,
    });
    const text = await response.text();
    return interpret(response.status, text, request);
  } catch (error) {
    return { kind: 'unreachable', message: abort.signal.aborted ? 'The host did not answer in time.' : messageOf(error) };
  } finally {
    clearTimeout(timer);
  }
}

function interpret<T>(status: number, text: string, request: HostRequest<T>): HostResult<T> {
  const body = text === '' ? undefined : parseJson(text);
  if (status === 401) return { kind: 'unauthorized' };
  if (status < 200 || status >= 300) {
    const error = ApiErrorReply.safeParse(body);
    return { kind: 'failed', status, message: error.success ? error.data.error.message : `The host answered ${String(status)}.` };
  }
  const parsed = lenient(request.reply).safeParse(body);
  return parsed.success
    ? { kind: 'ok', value: parsed.data }
    : { kind: 'malformed', message: `Unexpected reply from ${request.method} ${request.path}: ${parsed.error.message}` };
}

function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return text;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : 'Could not reach the host.';
}
