import { z } from 'zod';

/** Which tools a fixture server offers: a plain custom server, or a Composio-style server with several toolkits. */
export type FixtureTools = 'plain' | 'composio';

const object = (properties: Record<string, unknown> = {}) => ({ type: 'object', properties });

const TOOLS: Readonly<Record<FixtureTools, readonly object[]>> = {
  plain: [
    { name: 'echo', description: 'Says the text back, with the account.', inputSchema: object({ text: { type: 'string' } }) },
    { name: 'wait', description: 'Answers only when cancelled.', inputSchema: object() },
    { name: 'spawn_sleeper', description: 'Starts a long sleep in this server’s process group.', inputSchema: object() },
    { name: 'env', description: 'Which variables reached the server.', inputSchema: object() },
    { name: 'bad name!', description: 'Malformed: dropped by the client.', inputSchema: object() },
    { name: 'not_an_object', description: 'Malformed schema: dropped by the client.', inputSchema: { type: 'string' } },
  ],
  composio: [
    { name: 'GMAIL_SEND_EMAIL', description: 'Sends an email.', inputSchema: object({ to: { type: 'string' } }) },
    { name: 'GMAIL_FETCH_EMAILS', description: 'Lists emails.', inputSchema: object() },
    { name: 'GITHUB_STAR_REPO', description: 'Another toolkit on the same server.', inputSchema: object() },
  ],
};

const Request = z.looseObject({ jsonrpc: z.literal('2.0'), id: z.union([z.string(), z.number()]), method: z.string(), params: z.looseObject({}).optional() });
const Call = z.looseObject({ name: z.string(), arguments: z.looseObject({}).optional() });

/** What a fixture does with one request: answer it, hold it open (`wait`), or start a sleeper (stdio only). */
export type FixtureStep =
  | { readonly kind: 'answer'; readonly body: object }
  | { readonly kind: 'hold'; readonly id: string | number }
  | { readonly kind: 'spawn'; readonly id: string | number }
  | { readonly kind: 'env'; readonly id: string | number }
  | { readonly kind: 'none' };

/** The fixture's MCP server logic, shared by its stdio and HTTP transports. `account` is who it acts as. */
export function fixtureStep(message: unknown, tools: FixtureTools, account: string): FixtureStep {
  const request = Request.safeParse(message);
  if (!request.success) return { kind: 'none' };
  const { id, method, params } = request.data;
  const result = (value: object): FixtureStep => ({ kind: 'answer', body: { jsonrpc: '2.0', id, result: value } });
  switch (method) {
    case 'initialize':
      return result({ protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } });
    case 'tools/list':
      return result({ tools: TOOLS[tools] });
    case 'tools/call': {
      const call = Call.parse(params);
      if (call.name === 'wait') return { kind: 'hold', id };
      if (call.name === 'spawn_sleeper') return { kind: 'spawn', id };
      if (call.name === 'env') return { kind: 'env', id };
      if (call.name === 'GITHUB_STAR_REPO') return result({ content: [{ type: 'text', text: 'should never be routed' }] });
      const text = `${account} ran ${call.name} with ${JSON.stringify(call.arguments ?? {})}`;
      return result({ content: [{ type: 'text', text }], structuredContent: { account, tool: call.name } });
    }
    default:
      return { kind: 'answer', body: { jsonrpc: '2.0', id, error: { code: -32601, message: `No ${method}` } } };
  }
}
