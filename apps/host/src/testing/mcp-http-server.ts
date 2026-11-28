import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fixtureStep, type FixtureTools } from './mcp-fixture.ts';

/** What the HTTP fixture saw, for a test to check. Header values are recorded only as whether they matched. */
export interface HttpFixtureLog {
  readonly requests: string[];
}

export interface HttpFixture {
  /** The MCP endpoint, `http://127.0.0.1:<port>/mcp/<server>`. */
  readonly url: string;
  readonly log: HttpFixtureLog;
  close(): Promise<void>;
}

const SESSION = 'session-1';

/**
 * A Streamable HTTP MCP server for tests. It requires `header: value`, hands out a session at `initialize`,
 * answers `tools/call` as a server-sent event stream that first pings the client, and holds `wait` open
 * until the client goes away. It acts as the `user_id` or `connected_account_id` in the URL, or as `account`.
 */
export async function startHttpFixture(options: { readonly tools: FixtureTools; readonly header: string; readonly value: string; readonly account?: string }): Promise<HttpFixture> {
  const log: HttpFixtureLog = { requests: [] };
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://local');
    const account = url.searchParams.get('user_id') ?? url.searchParams.get('connected_account_id') ?? options.account ?? 'nobody';
    const session = request.headers['mcp-session-id'];
    const authorized = request.headers[options.header.toLowerCase()] === options.value;
    const chunks: Buffer[] = [];
    for await (const chunk of request) if (chunk instanceof Buffer) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    const message: unknown = text === '' ? null : JSON.parse(text);
    const method = typeof message === 'object' && message !== null && 'method' in message ? String(message.method) : 'answer';
    log.requests.push(`${request.method ?? ''} ${method} account=${account} auth=${String(authorized)} session=${String(session)} version=${String(request.headers['mcp-protocol-version'])}`);
    if (!authorized) {
      response.writeHead(401).end();
      return;
    }
    if (request.method === 'DELETE') {
      response.writeHead(200).end();
      return;
    }
    const step = fixtureStep(message, options.tools, account);
    switch (step.kind) {
      case 'none':
        response.writeHead(202).end();
        return;
      case 'answer':
        if (method === 'tools/call') {
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          response.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 'server-ping', method: 'ping' })}\n\n`);
          response.end(`data: ${JSON.stringify(step.body)}\n\n`);
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json', ...(method === 'initialize' ? { 'mcp-session-id': SESSION } : {}) }).end(JSON.stringify(step.body));
        return;
      case 'hold':
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(': waiting\n\n');
        response.once('close', () => {
          log.requests.push('wait stream closed by client');
        });
        return;
      case 'spawn':
      case 'env':
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: step.id, error: { code: -32601, message: 'stdio only' } }));
        return;
    }
  };
  const server = createServer((request, response) => {
    void handle(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return {
    url: `http://127.0.0.1:${String(address.port)}/mcp/server-1`,
    log,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => { resolve(); }));
    },
  };
}
