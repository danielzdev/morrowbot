import { abortFailure, McpFailure, type McpChannel } from './channel.ts';
import { answerServer, parseMessages, rpcFailure, type ServerMessage } from './json-rpc.ts';
import { readEvents } from './sse.ts';

/** The most a remote server may send for one request. */
const BODY_LIMIT = 16 * 1024 * 1024;

export interface HttpOptions {
  readonly url: string;
  /** Sent with every request. Their values never appear in a failure message. */
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * MCP's Streamable HTTP transport (https://modelcontextprotocol.io/specification/2025-11-25/basic/transports):
 * each message is one POST, answered with JSON or a server-sent event stream. The session id the
 * server gives at `initialize` goes with every later request, and `close` ends the session with DELETE.
 * Redirects are refused, so headers never follow a request to another address.
 */
export function openHttpChannel(options: HttpOptions): McpChannel {
  const where = new URL(options.url).host;
  const ended = new AbortController();
  let sessionId: string | undefined;
  let protocolVersion: string | undefined;
  let nextId = 1;
  let closed = false;

  const headers = (): Record<string, string> => ({
    ...options.headers,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...(sessionId === undefined ? {} : { 'mcp-session-id': sessionId }),
    ...(protocolVersion === undefined ? {} : { 'mcp-protocol-version': protocolVersion }),
  });

  const post = async (message: object, signal: AbortSignal): Promise<Response> => {
    const both = AbortSignal.any([signal, ended.signal]);
    try {
      const response = await fetch(options.url, { method: 'POST', headers: headers(), body: JSON.stringify(message), redirect: 'manual', signal: both });
      checkStatus(response, where, sessionId !== undefined);
      return response;
    } catch (error) {
      throw failureOf(error, signal, where);
    }
  };

  const answer = (message: ServerMessage): void => {
    if (message.kind !== 'request') return;
    void post(answerServer(message.id, message.method), AbortSignal.timeout(10_000)).then(
      (response) => response.body?.cancel(),
      () => undefined,
    );
  };

  const request = async (method: string, params: object, signal: AbortSignal): Promise<unknown> => {
    if (closed) throw new McpFailure('aborted', 'The connector was disconnected');
    const id = nextId++;
    const onAbort = (): void => {
      void post({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'The turn ended' } }, AbortSignal.timeout(5_000)).catch(() => undefined);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await post({ jsonrpc: '2.0', id, method, params }, signal);
      const session = response.headers.get('mcp-session-id');
      if (method === 'initialize' && session !== null) sessionId = session;
      const found = await readAnswer(response, id, signal, answer, where);
      if (found.kind === 'error') throw rpcFailure(found.error);
      return found.result;
    } catch (error) {
      throw failureOf(error, signal, where);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  };

  return {
    request,
    notify: async (method, params) => {
      const response = await post({ jsonrpc: '2.0', method, params }, AbortSignal.timeout(10_000));
      await response.body?.cancel();
    },
    onEnd: () => undefined,
    setProtocolVersion: (version) => {
      protocolVersion = version;
    },
    close: async () => {
      if (closed) return;
      closed = true;
      ended.abort(new DOMException('Disconnected', 'AbortError'));
      if (sessionId === undefined) return;
      try {
        const response = await fetch(options.url, { method: 'DELETE', headers: headers(), redirect: 'manual', signal: AbortSignal.timeout(5_000) });
        await response.body?.cancel();
      } catch {
        return;
      }
    },
  };
}

type Answer = Extract<ServerMessage, { kind: 'result' | 'error' }>;

async function readAnswer(response: Response, id: number, signal: AbortSignal, answer: (message: ServerMessage) => void, where: string): Promise<Answer> {
  const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (response.body === null) throw new McpFailure('protocol', `${where} sent an empty answer`);
  if (type === 'text/event-stream') {
    for await (const event of readEvents(response.body, BODY_LIMIT)) {
      if (event.event !== 'message') continue;
      for (const message of parseMessages(event.data)) {
        if ((message.kind === 'result' || message.kind === 'error') && message.id === id) {
          await response.body.cancel().catch(() => undefined);
          return message;
        }
        answer(message);
      }
    }
    if (signal.aborted) throw abortFailure(signal, 'the request');
    throw new McpFailure('unreachable', `${where} closed the stream before answering`);
  }
  if (type !== 'application/json') throw new McpFailure('protocol', `${where} answered with ${type ?? 'no content type'}, not JSON`);
  const text = await readLimited(response.body, BODY_LIMIT, where);
  const found = parseMessages(text).find((message): message is Answer => (message.kind === 'result' || message.kind === 'error') && message.id === id);
  if (found === undefined) throw new McpFailure('protocol', `${where} sent an answer this host cannot read`);
  return found;
}

async function readLimited(body: ReadableStream<Uint8Array>, limit: number, where: string): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > limit) {
      await body.cancel().catch(() => undefined);
      throw new McpFailure('protocol', `${where} sent more than this host reads`);
    }
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

function checkStatus(response: Response, where: string, inSession: boolean): void {
  if (response.status === 404 && inSession) throw new McpFailure('unreachable', `${where} ended the session; reconnect to start a new one`);
  if (response.status === 401 || response.status === 403) throw new McpFailure('auth', `${where} refused the credentials (HTTP ${String(response.status)})`);
  if (response.status >= 300 && response.status < 400) throw new McpFailure('protocol', `${where} redirected the request (HTTP ${String(response.status)}); enter the final URL`);
  if (response.status === 404 || response.status === 405) throw new McpFailure('protocol', `${where} has no MCP endpoint at this URL (HTTP ${String(response.status)})`);
  if (response.status >= 400) throw new McpFailure('unreachable', `${where} answered HTTP ${String(response.status)}`);
}

/** Every error as an `McpFailure`, without the request's headers in it. */
function failureOf(error: unknown, signal: AbortSignal, where: string): McpFailure {
  if (error instanceof McpFailure) return error;
  if (signal.aborted) return abortFailure(signal, 'the request');
  if (error instanceof DOMException && error.name === 'AbortError') return new McpFailure('aborted', 'The connector was disconnected');
  return new McpFailure('unreachable', `Could not reach ${where}`);
}
