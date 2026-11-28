import { z } from 'zod';
import { McpFailure, withTimeout, type McpChannel } from './channel.ts';

/** MCP revisions this client speaks, newest first. */
export const CLIENT_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
const SETUP_TIMEOUT_MS = 30_000;
const MAX_TOOL_PAGES = 20;
const MAX_TOOLS = 500;

/** A tool as the server described it, after its schema was checked. */
export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

/** What `tools/call` gave back, passed on to the agent as it is. */
export interface McpCallResult {
  readonly content: readonly Readonly<Record<string, unknown>>[];
  readonly structuredContent: Readonly<Record<string, unknown>> | null;
  readonly isError: boolean;
}

const InitializeResult = z.looseObject({
  protocolVersion: z.string(),
  capabilities: z.looseObject({ tools: z.looseObject({}).optional() }),
});
const ToolEntry = z.looseObject({
  name: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/),
  description: z.string().max(10_000).optional(),
  inputSchema: z.looseObject({ type: z.literal('object') }),
});
const ListResult = z.looseObject({ tools: z.array(z.unknown()), nextCursor: z.string().optional() });
const CallResult = z.looseObject({
  content: z.array(z.looseObject({ type: z.string() })).default([]),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
  isError: z.boolean().optional(),
});

export interface McpSession {
  readonly tools: readonly McpTool[];
  call(name: string, args: unknown, signal: AbortSignal): Promise<McpCallResult>;
  close(): Promise<void>;
}

/**
 * Opens an MCP session on `channel`: `initialize` in a version both sides speak, `notifications/initialized`,
 * then every page of `tools/list`. A tool whose name or input schema is malformed is left out.
 */
export async function startSession(channel: McpChannel, clientVersion: string, signal: AbortSignal): Promise<McpSession> {
  try {
    const init = InitializeResult.safeParse(
      await channel.request(
        'initialize',
        { protocolVersion: CLIENT_PROTOCOL_VERSIONS[0], capabilities: {}, clientInfo: { name: 'orikami', title: 'Ori Kami', version: clientVersion } },
        withTimeout(signal, SETUP_TIMEOUT_MS),
      ),
    );
    if (!init.success) throw new McpFailure('protocol', 'The server answered initialize in a shape this host cannot read');
    const version = CLIENT_PROTOCOL_VERSIONS.find((known) => known === init.data.protocolVersion);
    if (version === undefined) throw new McpFailure('protocol', `The server speaks MCP ${init.data.protocolVersion.slice(0, 40)}, which this host does not support`);
    if (init.data.capabilities.tools === undefined) throw new McpFailure('protocol', 'The server offers no tools');
    channel.setProtocolVersion(version);
    await channel.notify('notifications/initialized', {});
    const tools = await listTools(channel, withTimeout(signal, SETUP_TIMEOUT_MS));
    return {
      tools,
      call: async (name, args, callSignal) => {
        const parsed = CallResult.safeParse(await channel.request('tools/call', { name, arguments: args ?? {} }, callSignal));
        if (!parsed.success) throw new McpFailure('protocol', 'The server answered the tool call in a shape this host cannot read');
        return { content: parsed.data.content, structuredContent: parsed.data.structuredContent ?? null, isError: parsed.data.isError ?? false };
      },
      close: () => channel.close(),
    };
  } catch (error) {
    await channel.close();
    throw error;
  }
}

async function listTools(channel: McpChannel, signal: AbortSignal): Promise<McpTool[]> {
  const tools: McpTool[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_TOOL_PAGES; page++) {
    const parsed = ListResult.safeParse(await channel.request('tools/list', cursor === undefined ? {} : { cursor }, signal));
    if (!parsed.success) throw new McpFailure('protocol', 'The server listed its tools in a shape this host cannot read');
    for (const raw of parsed.data.tools) {
      const tool = ToolEntry.safeParse(raw);
      if (!tool.success || seen.has(tool.data.name) || tools.length >= MAX_TOOLS) continue;
      seen.add(tool.data.name);
      tools.push({ name: tool.data.name, description: tool.data.description ?? '', inputSchema: tool.data.inputSchema });
    }
    cursor = parsed.data.nextCursor;
    if (cursor === undefined) break;
  }
  return tools;
}
