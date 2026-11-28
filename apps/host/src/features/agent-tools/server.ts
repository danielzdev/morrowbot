import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { HostTools } from '@morrowbot/contracts';
import { createToolGrants, type ToolGrant } from './grants.ts';
import { answerMcp } from './mcp.ts';
import { memoryTools } from './memory-tools.ts';
import { messageTools } from './message-tools.ts';
import type { ToolPorts } from './ports.ts';
import { vaultTools } from './vault-tools.ts';

export const MCP_PATH = '/mcp';
/** A `send_message` text is at most 100 000 characters, which JSON-escaped stays well under this. */
const MAX_BODY_BYTES = 1024 * 1024;

export interface ToolServerOptions {
  readonly ports: ToolPorts;
  /** The host's version, as the MCP server reports it. */
  readonly version: string;
  readonly report: (error: unknown) => void;
}

/** The host's MCP server: loopback only, each request acting as the running turn its bearer token was issued to. */
export interface ToolServer {
  readonly url: string;
  /** Tools for one turn, good until `close(turnId)`. */
  open(grant: ToolGrant): HostTools;
  close(turnId: string): void;
  stop(): Promise<void>;
}

type Answer = { readonly status: number; readonly body: object | null; readonly headers?: Readonly<Record<string, string>> };

/**
 * Serves MCP's Streamable HTTP transport on `127.0.0.1` (no sessions, no server-sent events): each POST
 * carries one JSON-RPC message and gets one JSON answer. A request whose Host is not this address, or
 * that comes from a web page (`Origin`), is refused before its token is looked at.
 */
export async function startToolServer(options: ToolServerOptions): Promise<ToolServer> {
  const grants = createToolGrants();
  /** Each running turn's abort: closing the turn stops its connector calls. */
  const turns = new Map<string, AbortController>();
  const tools = [...messageTools(options.ports), ...memoryTools(options.ports), ...vaultTools(options.ports)];
  let authority = '';
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<Answer> => {
    if (request.headers.host !== authority || request.headers.origin !== undefined) return { status: 403, body: { error: 'Forbidden' } };
    if (new URL(request.url ?? '/', 'http://local').pathname !== MCP_PATH) return { status: 404, body: { error: 'Not found' } };
    const token = /^Bearer (\S+)$/.exec(request.headers.authorization ?? '')?.[1];
    const grant = token === undefined ? undefined : grants.check(token);
    if (grant === undefined) return { status: 401, body: { error: 'This token is unknown, or its turn has ended' } };
    if (request.method !== 'POST') return { status: 405, body: null, headers: { allow: 'POST' } };
    const body = await readBody(request);
    switch (body.kind) {
      case 'rejected':
        return body.answer;
      case 'read': {
        const dropped = new AbortController();
        response.once('close', () => {
          if (!response.writableFinished) dropped.abort();
        });
        const turn = turns.get(grant.turnId)?.signal ?? AbortSignal.abort();
        const signal = AbortSignal.any([turn, dropped.signal]);
        const answer = await answerMcp(body.value, { grant, tools, connectors: options.ports.connectors, signal }, options.version);
        return answer.kind === 'accepted' ? { status: 202, body: null } : { status: 200, body: answer.body };
      }
    }
  };
  const server = createServer((request, response) => {
    handle(request, response).then(
      (answer) => {
        reply(response, answer);
      },
      (error: unknown) => {
        options.report(error);
        reply(response, { status: 500, body: { error: 'The host hit an unexpected error' } });
      },
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === 'string') throw new Error('The tool server did not bind a TCP port');
  authority = `127.0.0.1:${String(address.port)}`;
  const url = `http://${authority}${MCP_PATH}`;
  return {
    url,
    open: (grant) => {
      turns.get(grant.turnId)?.abort();
      turns.set(grant.turnId, new AbortController());
      return { kind: 'mcp', url, token: grants.issue(grant) };
    },
    close: (turnId) => {
      grants.revoke(turnId);
      turns.get(turnId)?.abort();
      turns.delete(turnId);
    },
    stop: async () => {
      for (const turn of turns.values()) turn.abort();
      turns.clear();
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

function reply(response: ServerResponse, { status, body, headers = {} }: Answer): void {
  if (body === null) {
    response.writeHead(status, headers).end();
    return;
  }
  response.writeHead(status, { ...headers, 'content-type': 'application/json' }).end(JSON.stringify(body));
}

type Body = { readonly kind: 'read'; readonly value: unknown } | { readonly kind: 'rejected'; readonly answer: Answer };

async function readBody(request: IncomingMessage): Promise<Body> {
  const type = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') return rejected(415, 'Send the body as application/json');
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of request) {
      if (!(chunk instanceof Buffer)) continue;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) return rejected(413, 'Request body is too large');
      chunks.push(chunk);
    }
  } catch {
    return rejected(400, 'The request body was cut off');
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return { kind: 'read', value };
  } catch {
    return { kind: 'rejected', answer: { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } } } };
  }
}

const rejected = (status: number, error: string): Body => ({ kind: 'rejected', answer: { status, body: { error } } });
