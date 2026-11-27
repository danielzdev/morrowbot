import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { HealthResponse } from '@morrowbot/contracts';

export interface ListenAddress {
  readonly hostname: string;
  readonly port: number;
}

export interface HealthServer {
  readonly url: string;
  close(): Promise<void>;
}

export async function startHealthServer(address: ListenAddress, version: string): Promise<HealthServer> {
  const startedAt = performance.now();
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/health') {
      response.writeHead(404).end();
      return;
    }
    const body: HealthResponse = {
      status: 'ok',
      version,
      uptimeMs: Math.round(performance.now() - startedAt),
    };
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  await listen(server, address);
  return {
    url: `http://${address.hostname}:${String(boundPort(server))}`,
    close: () => closeServer(server),
  };
}

function listen(server: Server, address: ListenAddress): Promise<void> {
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
  if (address === null || typeof address === 'string') {
    throw new Error('Health server is not listening on a TCP port');
  }
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
