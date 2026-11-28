import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { HostTools } from '@morrowbot/contracts';
import { attachTools } from './attach-tools.ts';
import { cardTools } from './card-tools.ts';
import { createToolGrants, type ToolGrant } from './grants.ts';
import { answerMcp } from './mcp.ts';
import { memoryTools } from './memory-tools.ts';
import { messageTools } from './message-tools.ts';
import { resolveTools } from './plugin-tools.ts';
import type { ToolPorts } from './ports.ts';
import { replyTools } from './reply-tools.ts';
import { subagentTools } from './subagent-tools.ts';
import type { Tool } from './tool.ts';
import { routineTools } from './routine-tools.ts';
import { t3WatchTools } from './t3-watch-tools.ts';
import { vaultTools } from './vault-tools.ts';

export const MCP_PATH = '/mcp';
/** The tools a sub-agent's turn gets: it only reads, starts no sub-agents of its own and uses no connectors or tool plugins. */
const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(['search_memories']);
const NO_CONNECTORS: ToolPorts['connectors'] = {
  tools: () => [],
  call: () => Promise.resolve({ kind: 'refused', reason: 'A sub-agent cannot use connectors.' }),
};
/** A `send_message` text is at most 100 000 characters, which JSON-escaped stays well under this. */
const MAX_BODY_BYTES = 1024 * 1024;

export interface ToolServerOptions {
  readonly ports: ToolPorts;
  /** The host's version, as the MCP server reports it. */
  readonly version: string;
  readonly report: (error: unknown) => void;
  readonly warn?: (message: string) => void;
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
  const builtins: readonly Tool[] = [
    ...messageTools(options.ports),
    ...memoryTools(options.ports),
    ...vaultTools(options.ports),
    ...routineTools(options.ports),
    ...t3WatchTools(options.ports),
    ...subagentTools(options.ports),
    ...replyTools(options.ports),
    ...attachTools(options.ports),
    ...cardTools(options.ports),
  ];
  const warn =
    options.warn ??
    ((message: string) => {
      console.warn(`MorrowBot host: ${message}`);
    });
  const forSubagents = builtins.filter(({ name }) => SUBAGENT_TOOLS.has(name));
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
        const onClose = (): void => {
          if (!response.writableEnded) dropped.abort();
        };
        response.on('close', onClose);
        try {
          const signal = AbortSignal.any([grant.signal, dropped.signal]);
          const scope = options.ports.subagents.isSubagent(grant.threadId)
            ? { grant, tools: forSubagents, connectors: NO_CONNECTORS, signal }
            : { grant, tools: resolveTools(builtins, options.ports.pluginTools, grant.agentId, warn), connectors: options.ports.connectors, signal };
          const answer = await answerMcp(body.value, scope, options.version);
          return answer.kind === 'accepted' ? { status: 202, body: null } : { status: 200, body: answer.body };
        } finally {
          response.off('close', onClose);
        }
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
    open: (grant) => ({ kind: 'mcp', url, token: grants.issue(grant) }),
    close: (turnId) => {
      grants.revoke(turnId);
    },
    stop: async () => {
      grants.revokeAll();
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
  if (response.writableEnded || response.destroyed) return;
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
