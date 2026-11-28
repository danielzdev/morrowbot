import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { LOOPBACK_TOKEN_PREFIX } from '@morrowbot/contracts';
import { WebSocketServer, type WebSocket } from 'ws';

export interface LoopbackServerOptions {
  /** The port on 127.0.0.1; 0 picks a free one (tests). */
  readonly port: number;
  /** Clients must offer the subprotocol `token.<token>`. Compared in constant time. */
  readonly token: string;
  /** The subprotocol the server speaks; clients must offer it and the server answers with it. */
  readonly subprotocol: string;
  /** Which `Origin` headers may connect. A request with no `Origin` is refused. */
  readonly origin: RegExp;
  /** Frames larger than this close the connection. */
  readonly maxMessageBytes: number;
  /** One authenticated connection. */
  readonly onConnection: (socket: LoopbackSocket) => void;
}

/** One authenticated client. Text frames only. */
export interface LoopbackSocket {
  readonly origin: string;
  send(text: string): void;
  close(code: number, reason: string): void;
  onMessage(listener: (text: string) => void): void;
  onClose(listener: () => void): void;
}

export interface LoopbackServer {
  readonly port: number;
  /** Stops listening and closes every connection. */
  close(): Promise<void>;
}

/**
 * Listens for WebSocket clients on 127.0.0.1 only. A client is refused before the upgrade unless its
 * `Host` is the loopback address, its `Origin` matches, and it offers both the subprotocol and the
 * pairing token, so a web page or another program without the token never gets a socket.
 */
export async function serveLoopback(options: LoopbackServerOptions): Promise<LoopbackServer> {
  const expected = digest(options.token);
  const sockets = new WebSocketServer({ noServer: true, maxPayload: options.maxMessageBytes, handleProtocols: () => options.subprotocol });
  const server = createServer((_request, response) => {
    response.writeHead(426, { 'content-type': 'text/plain' }).end('WebSocket only');
  });
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => {
      socket.destroy();
    });
    const refusal = refuse(request, options, expected, listeningPort());
    if (refusal !== null) {
      socket.end(`HTTP/1.1 ${refusal}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    sockets.handleUpgrade(request, socket, head, (client) => {
      options.onConnection(wrap(client, request.headers.origin ?? ''));
    });
  });
  const listeningPort = (): number => {
    const address = server.address();
    return address !== null && typeof address === 'object' ? address.port : options.port;
  };
  await new Promise<void>((resolve, reject) => {
    server.once('error', (error: Error & { code?: string }) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(`Port ${String(options.port)} on 127.0.0.1 is already in use. Pick another port in the plugin's settings and the extension's options.`)
          : error,
      );
    });
    server.listen(options.port, '127.0.0.1', () => {
      resolve();
    });
  });
  return {
    port: listeningPort(),
    close: async () => {
      for (const client of sockets.clients) client.terminate();
      sockets.close();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

function refuse(request: IncomingMessage, options: LoopbackServerOptions, expected: Buffer, port: number): string | null {
  const host = request.headers.host ?? '';
  if (host !== `127.0.0.1:${String(port)}` && host !== `localhost:${String(port)}`) return '403 Forbidden';
  const origin = request.headers.origin;
  if (origin === undefined || !options.origin.test(origin)) return '403 Forbidden';
  const offered = (request.headers['sec-websocket-protocol'] ?? '').split(',').map((entry) => entry.trim());
  if (!offered.includes(options.subprotocol)) return '400 Bad Request';
  const token = offered.find((entry) => entry.startsWith(LOOPBACK_TOKEN_PREFIX))?.slice(LOOPBACK_TOKEN_PREFIX.length);
  if (token === undefined || !timingSafeEqual(digest(token), expected)) return '401 Unauthorized';
  return null;
}

function digest(text: string): Buffer {
  return createHash('sha256').update(text).digest();
}

function wrap(client: WebSocket, origin: string): LoopbackSocket {
  return {
    origin,
    send: (text) => {
      if (client.readyState === client.OPEN) client.send(text);
    },
    close: (code, reason) => {
      client.close(code, reason);
    },
    onMessage: (listener) => {
      client.on('message', (data, isBinary) => {
        if (isBinary) {
          client.close(1003, 'Text frames only');
          return;
        }
        listener(Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data)]).toString('utf8'));
      });
    },
    onClose: (listener) => {
      client.on('close', listener);
    },
  };
}
