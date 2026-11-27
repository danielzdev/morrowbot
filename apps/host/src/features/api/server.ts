import { createServer, type IncomingMessage, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { agentRoutes } from './agent-routes.ts';
import { pluginRoutes } from './plugin-routes.ts';
import type { ApiServices } from './ports.ts';
import { failure, readJson, send, type Reply } from './reply.ts';
import type { Route } from './route.ts';
import { threadRoutes } from './thread-routes.ts';

export const EVENTS_PATH = '/api/events';

export interface ApiServerOptions {
  readonly address: { readonly hostname: '127.0.0.1'; readonly port: number };
  readonly services: ApiServices;
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
  const routes = [...agentRoutes(options.services), ...threadRoutes(options.services), ...pluginRoutes(options.services)];
  const sockets = new WebSocketServer({ noServer: true });
  let port = options.address.port;

  const server = createServer((request, response) => {
    const rejection = guard(request, port);
    if (rejection !== undefined) {
      send(response, rejection);
      return;
    }
    const path = pathOf(request);
    if (!path.startsWith('/api/')) {
      options.fallback(request, response);
      return;
    }
    dispatch(routes, path, request).then(
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
    if (guard(request, port) !== undefined || pathOf(request) !== EVENTS_PATH) {
      socket.end('HTTP/1.1 403 Forbidden\r\nconnection: close\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      const unsubscribe = options.services.chat.subscribe((event) => {
        ws.send(JSON.stringify(event));
      });
      ws.on('close', unsubscribe);
      ws.on('error', options.report);
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

/** Blocks DNS-rebinding (wrong Host) and any browser page (Origin present) from reaching the local API. */
function guard(request: IncomingMessage, port: number): Reply | undefined {
  const allowedHosts = new Set([`127.0.0.1:${String(port)}`, `localhost:${String(port)}`]);
  if (!allowedHosts.has(request.headers.host ?? '')) return failure('forbidden', 'Unexpected Host header');
  if (request.headers.origin !== undefined) return failure('forbidden', 'Browser origins may not use the local API');
  return undefined;
}

function pathOf(request: IncomingMessage): string {
  return new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
}

async function dispatch(routes: readonly Route[], path: string, request: IncomingMessage): Promise<Reply> {
  let pathMatched = false;
  for (const route of routes) {
    const match = route.path.exec(path);
    if (match === null) continue;
    pathMatched = true;
    if (route.method !== request.method) continue;
    let id: string;
    try {
      id = decodeURIComponent(match[1] ?? '');
    } catch {
      return failure('invalid_request', 'Malformed id in path');
    }
    return route.handle({ id, body: () => readJson(request) });
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

