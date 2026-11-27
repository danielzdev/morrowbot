import { createServer, type IncomingMessage, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { EventClientFrame, type EventServerFrame } from '@morrowbot/contracts';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { agentRoutes } from './agent-routes.ts';
import { folderRoutes } from './folder-routes.ts';
import { admit, authority, identify, isLoopback, isWildcard, screen, type Caller, type Listener } from './guard.ts';
import { pairingRoutes } from './pairing-routes.ts';
import { pluginRoutes } from './plugin-routes.ts';
import type { ApiServices } from './ports.ts';
import { failure, readJson, send, type Reply } from './reply.ts';
import { matchPath, type Params, type Route } from './route.ts';
import { threadRoutes } from './thread-routes.ts';

export const EVENTS_PATH = '/api/events';

export interface ApiServerOptions {
  /** `127.0.0.1` unless the user opted in to a LAN or Tailscale address. */
  readonly address: Listener;
  readonly services: ApiServices;
  /**
   * Requests carry `authorization: Bearer <token>`: this launch's token (kept only in memory) or a paired device's.
   * Only the pairing claim is open without one.
   */
  readonly token: string;
  readonly hostName: string;
  readonly hostVersion: string;
  /** Handles every request outside `/api/` (after the Host, Origin and token checks). */
  readonly fallback: RequestListener;
  readonly report: (error: unknown) => void;
}

export interface ApiServer {
  readonly url: string;
  close(): Promise<void>;
}

/** Serves the HTTP + WebSocket API on the configured address (loopback by default). */
export async function startApiServer(options: ApiServerOptions): Promise<ApiServer> {
  const deviceSockets = new Map<string, Set<WebSocket>>();
  let listener: Listener = options.address;
  const routes = [
    ...agentRoutes(options.services),
    ...folderRoutes(options.services),
    ...threadRoutes(options.services),
    ...pluginRoutes(options.services),
    ...pairingRoutes({
      pairing: options.services.pairing,
      hostName: options.hostName,
      hostVersion: options.hostVersion,
      remoteUrl: () => (isLoopback(listener.hostname) || isWildcard(listener.hostname) ? undefined : `http://${authority(listener)}`),
      closeDeviceSockets: (deviceId) => {
        for (const ws of deviceSockets.get(deviceId) ?? []) ws.close(1008, 'This device was unpaired');
      },
    }),
  ];
  const sockets = new WebSocketServer({ noServer: true });

  const server = createServer((request, response) => {
    const rejection = screen(request, listener);
    if (rejection !== undefined) {
      send(response, rejection);
      return;
    }
    const caller = identify(request, options.token, options.services.pairing);
    const path = pathOf(request);
    if (!path.startsWith('/api/')) {
      const denied = admit('token', caller);
      if (denied === undefined) options.fallback(request, response);
      else send(response, denied);
      return;
    }
    route(routes, path, request, caller).then(
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
    const screened = screen(request, listener);
    const caller: Caller = screened === undefined ? identify(request, options.token, options.services.pairing) : { kind: 'anonymous' };
    const rejection = screened ?? admit('token', caller);
    if (rejection !== undefined || pathOf(request) !== EVENTS_PATH) {
      const status = rejection?.status === 401 ? '401 Unauthorized' : '403 Forbidden';
      socket.end(`HTTP/1.1 ${status}\r\nconnection: close\r\n\r\n`);
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      if (caller.kind === 'device') track(deviceSockets, caller.deviceId, ws);
      serveEvents(ws, options);
    });
  });

  await listen(server, options.address);
  listener = { hostname: options.address.hostname, port: boundPort(server) };
  const local = isWildcard(listener.hostname) ? { ...listener, hostname: '127.0.0.1' } : listener;
  return {
    url: `http://${authority(local)}`,
    close: async () => {
      for (const client of sockets.clients) client.terminate();
      sockets.close();
      server.closeAllConnections();
      await closeServer(server);
    },
  };
}

/** Remembers a paired device's open socket, so unpairing the device can close it. */
function track(deviceSockets: Map<string, Set<WebSocket>>, deviceId: string, ws: WebSocket): void {
  const open = deviceSockets.get(deviceId) ?? new Set<WebSocket>();
  deviceSockets.set(deviceId, open);
  open.add(ws);
  ws.once('close', () => {
    open.delete(ws);
    if (open.size === 0) deviceSockets.delete(deviceId);
  });
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

/** Routes an `/api/` request. Without a valid token, only a public route is found; anything else is 401. */
async function route(routes: readonly Route[], path: string, request: IncomingMessage, caller: Caller): Promise<Reply> {
  const found = find(routes, path, request.method);
  const denied = admit(found.kind === 'route' ? (found.route.access ?? 'token') : 'token', caller);
  if (denied !== undefined) return denied;
  if (found.kind === 'reply') return found.reply;
  const query = URL.parse(request.url ?? '/', 'http://127.0.0.1')?.searchParams ?? new URLSearchParams();
  return found.route.handle({ params: found.params, query, body: () => readJson(request) });
}

type Found = { readonly kind: 'route'; readonly route: Route; readonly params: Params } | { readonly kind: 'reply'; readonly reply: Reply };

function find(routes: readonly Route[], path: string, method: string | undefined): Found {
  let pathMatched = false;
  for (const candidate of routes) {
    const match = matchPath(candidate.path, path);
    if (match.kind === 'no-match') continue;
    if (match.kind === 'malformed') return { kind: 'reply', reply: failure('invalid_request', 'Malformed id in path') };
    pathMatched = true;
    if (candidate.method !== method) continue;
    return { kind: 'route', route: candidate, params: match.params };
  }
  return {
    kind: 'reply',
    reply: pathMatched ? failure('invalid_request', 'Method not allowed', 405) : failure('not_found', 'No such endpoint'),
  };
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

