import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { EventClientFrame, type EventServerFrame } from '@morrowbot/contracts';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { agentRoutes } from './agent-routes.ts';
import { folderRoutes } from './folder-routes.ts';
import { pluginRoutes } from './plugin-routes.ts';
import type { ApiServices } from './ports.ts';
import { failure, readJson, send, type Reply } from './reply.ts';
import { matchPath, type Route } from './route.ts';
import { threadRoutes } from './thread-routes.ts';
import { usageRoutes } from './usage-routes.ts';

export const EVENTS_PATH = '/api/events';

export interface ApiServerOptions {
  readonly address: { readonly hostname: '127.0.0.1'; readonly port: number };
  readonly services: ApiServices;
  /** Every request must carry `authorization: Bearer <token>`; the token lives only in memory for this launch. */
  readonly token: string;
  /** Handles every request outside `/api/` (after the loopback checks). */
  readonly fallback: RequestListener;
  readonly report: (error: unknown) => void;
}

export interface ApiServer {
  readonly url: string;
  close(): Promise<void>;
}

/** Serves the local HTTP + WebSocket API on 127.0.0.1 only. */
export async function startApiServer(options: ApiServerOptions): Promise<ApiServer> {
  const routes = [
    ...agentRoutes(options.services),
    ...folderRoutes(options.services),
    ...threadRoutes(options.services),
    ...pluginRoutes(options.services),
    ...usageRoutes(options.services),
  ];
  const sockets = new WebSocketServer({ noServer: true });
  let port = options.address.port;

  const server = createServer((request, response) => {
    const rejection = guard(request, port, options.token);
    if (rejection !== undefined) {
      send(response, rejection);
      return;
    }
    const path = pathOf(request);
    if (!path.startsWith('/api/')) {
      options.fallback(request, response);
      return;
    }
    route(routes, path, request).then(
      (reply) => {
        send(response, reply);
      },
      (error: unknown) => {
        options.report(error);
        send(response, failure('internal', 'The host hit an unexpected error'));
      },
    );
  });

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const rejection = guard(request, port, options.token);
    if (rejection !== undefined || pathOf(request) !== EVENTS_PATH) {
      const status = rejection?.status === 401 ? '401 Unauthorized' : '403 Forbidden';
      socket.end(`HTTP/1.1 ${status}\r\nconnection: close\r\n\r\n`);
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      serveEvents(ws, options);
    });
  });

  await listen(server, options.address);
  port = boundPort(server);
  return {
    url: `http://${options.address.hostname}:${String(port)}`,
    close: async () => {
      for (const client of sockets.clients) client.terminate();
      sockets.close();
      server.closeAllConnections();
      await closeServer(server);
    },
  };
}

/**
 * Blocks DNS-rebinding (wrong Host), any browser page (Origin present) and any local process without
 * this launch's token from reaching the local API.
 */
function guard(request: IncomingMessage, port: number, token: string): Reply | undefined {
  const allowedHosts = new Set([`127.0.0.1:${String(port)}`, `localhost:${String(port)}`]);
  if (!allowedHosts.has(request.headers.host?.toLowerCase() ?? '')) return failure('forbidden', 'Unexpected Host header');
  if (request.headers.origin !== undefined) return failure('forbidden', 'Browser origins may not use the local API');
  if (!sameSecret(request.headers.authorization ?? '', `Bearer ${token}`)) return failure('unauthorized', 'Missing or wrong host token');
  return undefined;
}

function sameSecret(given: string, expected: string): boolean {
  const digest = (text: string): Buffer => createHash('sha256').update(text, 'utf8').digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * One `/api/events` socket. Global events always go out; a thread's events only after `subscribe`.
 * A subscribe with a cursor first replays what was missed (or sends `resync`), in the same
 * synchronous step that starts live delivery, so nothing is missed or sent twice.
 */
function serveEvents(ws: WebSocket, options: ApiServerOptions): void {
  const { chat } = options.services;
  const threads = new Set<string>();
  const sendFrame = (frame: EventServerFrame): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
  };
  const unsubscribe = chat.subscribe((event) => {
    if (event.kind === 'usage.updated' || threads.has(event.threadId)) sendFrame(event);
  });
  ws.on('message', (data, isBinary) => {
    const frame = isBinary ? undefined : EventClientFrame.safeParse(parseJson(textOf(data)));
    if (frame?.success !== true) {
      ws.close(1008, 'Expected a subscribe or unsubscribe frame');
      return;
    }
    const { threadId } = frame.data;
    switch (frame.data.kind) {
      case 'unsubscribe':
        threads.delete(threadId);
        return;
      case 'subscribe': {
        if (frame.data.since === null) {
          threads.add(threadId);
          return;
        }
        const replay = chat.replay(threadId, frame.data.since);
        switch (replay.kind) {
          case 'resync':
            threads.delete(threadId);
            sendFrame({ kind: 'resync', threadId });
            return;
          case 'events':
            for (const event of replay.events) sendFrame(event);
            threads.add(threadId);
            return;
        }
      }
    }
  });
  ws.on('close', unsubscribe);
  ws.on('error', options.report);
}

function textOf(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

/** The request path, or '' when Node accepted a target that is not a valid URL. */
function pathOf(request: IncomingMessage): string {
  return URL.parse(request.url ?? '/', 'http://127.0.0.1')?.pathname ?? '';
}

async function route(routes: readonly Route[], path: string, request: IncomingMessage): Promise<Reply> {
  let pathMatched = false;
  const query = URL.parse(request.url ?? '/', 'http://127.0.0.1')?.searchParams ?? new URLSearchParams();
  for (const candidate of routes) {
    const match = matchPath(candidate.path, path);
    if (match.kind === 'no-match') continue;
    if (match.kind === 'malformed') return failure('invalid_request', 'Malformed id in path');
    pathMatched = true;
    if (candidate.method !== request.method) continue;
    return candidate.handle({ params: match.params, query, body: () => readJson(request) });
  }
  return pathMatched ? failure('invalid_request', 'Method not allowed', 405) : failure('not_found', 'No such endpoint');
}

function listen(server: Server, address: ApiServerOptions['address']): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(address.port, address.hostname, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function boundPort(server: Server): number {
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === 'string') throw new Error('API server is not listening on a TCP port');
  return address.port;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

