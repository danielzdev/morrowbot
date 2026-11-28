import { HOST_TOOLS_SERVER } from '@morrowbot/contracts';
import { z } from 'zod';
import type { ToolGrant } from './grants.ts';
import type { Tool } from './tool.ts';

/** MCP revisions this server answers in, newest first (https://modelcontextprotocol.io/specification). */
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;

const RequestId = z.union([z.string(), z.number()]);
type RequestId = z.infer<typeof RequestId>;
const ClientRequest = z.looseObject({ jsonrpc: z.literal('2.0'), id: RequestId, method: z.string(), params: z.unknown().optional() });
/** A notification, or the client's answer to a request of ours (we send none): both are only acknowledged. */
const ClientOther = z.looseObject({ jsonrpc: z.literal('2.0') });
const InitializeParams = z.looseObject({ protocolVersion: z.string() });
const CallParams = z.looseObject({ name: z.string(), arguments: z.unknown().optional() });

/** What to answer one POSTed message with: a JSON-RPC response, or nothing (HTTP 202) for a notification. */
export type McpAnswer = { readonly kind: 'respond'; readonly body: object } | { readonly kind: 'accepted' };

/** Answers one MCP message for a turn's grant: `initialize`, `ping`, `tools/list` and `tools/call`. */
export async function answerMcp(message: unknown, grant: ToolGrant, tools: readonly Tool[], version: string): Promise<McpAnswer> {
  const parsed = ClientRequest.safeParse(message);
  if (!parsed.success) return ClientOther.safeParse(message).success ? { kind: 'accepted' } : error(null, -32600, 'Invalid Request: send one JSON-RPC 2.0 message');
  const { id, method, params } = parsed.data;
  switch (method) {
    case 'initialize': {
      const asked = InitializeParams.safeParse(params);
      const protocolVersion = PROTOCOL_VERSIONS.find((known) => asked.success && known === asked.data.protocolVersion) ?? PROTOCOL_VERSIONS[0];
      return result(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: HOST_TOOLS_SERVER, title: 'MorrowBot', version },
        instructions:
          'MorrowBot tools: message your teammate agents, keep your own memories and start sub-agents. They act only as you, and only during this turn.',
      });
    }
    case 'ping':
      return result(id, {});
    case 'tools/list':
      return result(id, { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call':
      return callTool(id, params, grant, tools);
    default:
      return error(id, -32601, `Method not found: ${method}`);
  }
}

async function callTool(id: RequestId, params: unknown, grant: ToolGrant, tools: readonly Tool[]): Promise<McpAnswer> {
  const call = CallParams.safeParse(params);
  if (!call.success) return error(id, -32602, 'Invalid params: name the tool to call');
  const found = tools.find(({ name }) => name === call.data.name);
  if (found === undefined) return error(id, -32602, `Unknown tool: ${call.data.name}`);
  const outcome = await found.call(grant, call.data.arguments);
  switch (outcome.kind) {
    case 'done':
      return result(id, { content: [{ type: 'text', text: JSON.stringify(outcome.value) }], structuredContent: outcome.value, isError: false });
    case 'refused':
      return result(id, { content: [{ type: 'text', text: outcome.reason }], isError: true });
  }
}

const result = (id: RequestId, value: object): McpAnswer => ({ kind: 'respond', body: { jsonrpc: '2.0', id, result: value } });

const error = (id: RequestId | null, code: number, message: string): McpAnswer => ({
  kind: 'respond',
  body: { jsonrpc: '2.0', id, error: { code, message } },
});
