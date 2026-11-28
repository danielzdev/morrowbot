import type { ToolImageMimeType } from '@morrowbot/contracts';
import { z } from 'zod';
import type { ToolGrant } from './grants.ts';

/** One MCP tool-result content block (text or base64 image). */
export type McpContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly data: string; readonly mimeType: ToolImageMimeType };

/** What a tool call gave back: structured JSON, MCP content blocks, or why nothing was done. */
export type ToolResult =
  | { readonly kind: 'done'; readonly value: object }
  | { readonly kind: 'content'; readonly blocks: readonly McpContentBlock[] }
  | { readonly kind: 'refused'; readonly reason: string };

/** One MorrowBot tool as MCP lists it. `call` parses the arguments, then acts only as `grant`'s agent. */
export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /** When set, hides the tool from `tools/list` for agents where this returns false. */
  readonly visible?: (agentId: string) => boolean;
  call(grant: ToolGrant, args: unknown, signal: AbortSignal): ToolResult | Promise<ToolResult>;
}

export function tool<S extends z.ZodType>(definition: {
  readonly name: string;
  readonly description: string;
  readonly input: S;
  readonly visible?: (agentId: string) => boolean;
  readonly run: (grant: ToolGrant, input: z.output<S>, signal: AbortSignal) => ToolResult | Promise<ToolResult>;
}): Tool {
  const inputSchema = z.toJSONSchema(definition.input, { io: 'input' });
  delete inputSchema.$schema;
  return {
    name: definition.name,
    description: definition.description,
    inputSchema,
    ...(definition.visible === undefined ? {} : { visible: definition.visible }),
    call: (grant, args, signal) => {
      const parsed = definition.input.safeParse(args ?? {});
      return parsed.success ? definition.run(grant, parsed.data, signal) : refused(z.prettifyError(parsed.error));
    },
  };
}

export const done = (value: object): ToolResult => ({ kind: 'done', value });
export const content = (blocks: readonly McpContentBlock[]): ToolResult => ({ kind: 'content', blocks });
export const refused = (reason: string): ToolResult => ({ kind: 'refused', reason });
