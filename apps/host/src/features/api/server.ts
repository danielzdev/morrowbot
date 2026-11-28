import { createServer, type IncomingMessage, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import type { WhoAmI } from '@morrowbot/contracts';
import { WebSocketServer, type WebSocket } from 'ws';
import { authorize, viewerOf, type Caller } from './access.ts';
import { agentMessageRoutes } from './agent-message-routes.ts';
import { agentRoutes } from './agent-routes.ts';
import { attachmentRoutes } from './attachment-routes.ts';
import { connectorRoutes } from './connector-routes.ts';
import { folderRoutes } from './folder-routes.ts';
import { memoryRoutes } from './memory-routes.ts';
import { serveEvents } from './event-socket.ts';
import { authority, identify, isLoopback, isWildcard, screen, type Listener } from './guard.ts';
import { memberRoutes } from './member-routes.ts';
import { pairingRoutes } from './pairing-routes.ts';
import { pluginRoutes } from './plugin-routes.ts';
import type { ApiServices } from './ports.ts';
import { failure, readJson, send, type Reply } from './reply.ts';
import { matchPath, type Params, type Route } from './route.ts';
import { routineRoutes } from './routine-routes.ts';
import { settingsRoutes } from './settings-routes.ts';
import { skillRoutes } from './skill-routes.ts';
import { t3WatchRoutes } from './t3-watch-routes.ts';
import { threadRoutes } from './thread-routes.ts';
import { usageRoutes } from './usage-routes.ts';
import { vaultRoutes } from './vault-routes.ts';

export const EVENTS_PATH = '/api/events';
/** How long an unpaired device's or revoked member's socket gets to finish the close handshake before it is cut. */
const SIGNED_OUT_CLOSE_MS = 1000;
/** A public route's body (the pairing claim) is tiny, so a stranger cannot make the host buffer much. */
const PUBLIC_BODY_BYTES = 4096;

/** Node stops listening for errors on a socket it hands to `upgrade`; a peer resetting it must not crash the host. */
function ignoreSocketError(): void {
  return;
}

export interface ApiServerOptions {
  /** `127.0.0.1` unless the user opted in to a LAN or Tailscale address. */
  readonly address: Listener;
  readonly services: ApiServices;
  /**
   * Requests carry `authorization: Bearer <token>`: this launch's token (kept only in memory), a paired device's
   * or a member's. Only the pairing and invite claims are open without one.
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
  const signedIn = new Map<string, Set<WebSocket>>();
  let listener: Listener = options.address;
  const remoteUrl = (): string | undefined =>
    isLoopback(listener.hostname) || isWildcard(listener.hostname) ? undefined : new URL(`http://${authority(listener)}`).origin;
  const closeSockets = (key: string, reason: string): void => {
    for (const ws of signedIn.get(key) ?? []) {
      ws.close(1008, reason);
      const cut = setTimeout(() => {
        ws.terminate();
      }, SIGNED_OUT_CLOSE_MS).unref();
      ws.once('close', () => {
        clearTimeout(cut);
      });
    }
  };
  const routes = [
    ...agentRoutes(options.services),
    ...agentMessageRoutes(options.services),
    ...folderRoutes(options.services),
    ...threadRoutes(options.services),
    ...attachmentRoutes(options.services),
    ...memoryRoutes(options.services),
    ...skillRoutes(options.services),
    ...pluginRoutes(options.services),
    ...connectorRoutes(options.services),
    ...usageRoutes(options.services),
    ...routineRoutes(options.services),
    ...t3WatchRoutes(options.services),
    ...settingsRoutes(options.services),
    ...vaultRoutes(options.services),
    ...pairingRoutes({
      pairing: options.services.pairing,
      hostName: options.hostName,
      hostVersion: options.hostVersion,
      remoteUrl,
      closeDeviceSockets: (deviceId) => {
        closeSockets(`device:${deviceId}`, 'This device was unpaired');
      },
    }),
    ...memberRoutes({
      members: options.services.members,
      hostName: options.hostName,
      hostVersion: options.hostVersion,
      remoteUrl,
      closeMemberSockets: (memberId) => {
        closeSockets(`member:${memberId}`, 'Your access to this server was revoked');
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
    const caller = identifyOrReport(request, options);
    if (caller === undefined) {
      send(response, failure('internal', 'The host hit an unexpected error'));
      return;
    }
    const path = pathOf(request);
    if (!path.startsWith('/api/')) {
      if (caller.kind === 'anonymous') send(response, failure('unauthorized', 'Missing or wrong token'));
      else options.fallback(request, response);
      return;
    }
    route(routes, path, request, caller, options.services).then(
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
    socket.on('error', ignoreSocketError);
    const screened = screen(request, listener);
    const caller: Caller | undefined = screened === undefined ? identifyOrReport(request, options) : { kind: 'anonymous' };
    const rejection =
      screened ??
      (caller === undefined ? failure('internal', 'Authentication failed') : caller.kind === 'anonymous' ? failure('unauthorized', 'Missing or wrong token') : undefined);
    if (rejection !== undefined || caller === undefined || caller.kind === 'anonymous' || pathOf(request) !== EVENTS_PATH) {
      const status = rejection?.status === 401 ? '401 Unauthorized' : rejection?.status === 500 ? '500 Internal Server Error' : '403 Forbidden';
      socket.once('finish', () => {
        socket.destroy();
      });
      socket.end(`HTTP/1.1 ${status}\r\nconnection: close\r\n\r\n`);
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      if (caller.kind === 'device') track(signedIn, `device:${caller.deviceId}`, ws);
      if (caller.kind === 'member') track(signedIn, `member:${caller.member.memberId}`, ws);
      serveEvents(ws, options.services, viewerOf(caller), options.report);
    });
  });

  await listen(server, options.address);
  listener = { hostname: options.address.hostname, port: boundPort(server) };
  const local = isWildcard(listener.hostname) ? { ...listener, hostname: listener.hostname === '::' ? '::1' : '127.0.0.1' } : listener;
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

/** Who sent the request; undefined (after reporting) when the device lookup itself failed, such as a storage error. */
function identifyOrReport(request: IncomingMessage, options: ApiServerOptions): Caller | undefined {
  try {
    return identify(request, options.token, options.services.pairing, options.services.members);
  } catch (error) {
    options.report(error);
    return undefined;
  }
}

/** Remembers a device's or member's open socket, so unpairing or revoking it can close it. */
function track(signedIn: Map<string, Set<WebSocket>>, key: string, ws: WebSocket): void {
  const open = signedIn.get(key) ?? new Set<WebSocket>();
  signedIn.set(key, open);
  open.add(ws);
  ws.once('close', () => {
    open.delete(ws);
    if (open.size === 0) signedIn.delete(key);
  });
}

/** The request path, or '' when Node accepted a target that is not a valid URL. */
function pathOf(request: IncomingMessage): string {
  return URL.parse(request.url ?? '/', 'http://127.0.0.1')?.pathname ?? '';
}

/**
 * Routes an `/api/` request. Without a valid token, only a public route is found; anything else is 401. Every other
 * route is authorized for the caller before its handler runs: left without an access, a route is the owner's only.
 */
async function route(routes: readonly Route[], path: string, request: IncomingMessage, caller: Caller, services: ApiServices): Promise<Reply> {
  const found = find(routes, path, request.method);
  if (found.kind === 'reply') return caller.kind === 'anonymous' ? failure('unauthorized', 'Missing or wrong token') : found.reply;
  const access = found.route.access ?? { kind: 'owner' };
  if (access.kind === 'public' && request.headers.origin !== undefined) return failure('forbidden', 'Browser pages may not claim a pairing code or invite');
  const admission = await authorize(access, caller, found.params, services);
  if (admission.kind === 'denied') return admission.reply;
  const query = URL.parse(request.url ?? '/', 'http://127.0.0.1')?.searchParams ?? new URLSearchParams();
  return found.route.handle({
    params: found.params,
    query,
    source: request.socket.remoteAddress ?? '',
    viewer: admission.viewer,
    whoAmI: whoAmIOf(caller),
    body: () => readJson(request, access.kind === 'public' ? PUBLIC_BODY_BYTES : found.route.bodyBytes),
  });
}

function whoAmIOf(caller: Caller): WhoAmI {
  return caller.kind === 'member' ? { kind: 'member', memberId: caller.member.memberId, name: caller.member.name, access: caller.member.access } : { kind: 'owner' };
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

