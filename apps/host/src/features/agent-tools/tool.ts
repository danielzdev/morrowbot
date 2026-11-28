import { z } from 'zod';
import type { ToolGrant } from './grants.ts';

/** What a tool call gave back: a JSON value for the model, or why nothing was done. */
export type ToolResult = { readonly kind: 'done'; readonly value: object } | { readonly kind: 'refused'; readonly reason: string };

/** One MorrowBot tool as MCP lists it. `call` parses the arguments, then acts only as `grant`'s agent. */
export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.core.JSONSchema.BaseSchema;
  call(grant: ToolGrant, args: unknown): ToolResult | Promise<ToolResult>;
}

export function tool<S extends z.ZodType>(definition: {
  readonly name: string;
  readonly description: string;
  readonly input: S;
  readonly run: (grant: ToolGrant, input: z.output<S>) => ToolResult | Promise<ToolResult>;
}): Tool {
  const inputSchema = z.toJSONSchema(definition.input, { io: 'input' });
  delete inputSchema.$schema;
  return {
    name: definition.name,
    description: definition.description,
    inputSchema,
    call: (grant, args) => {
      const parsed = definition.input.safeParse(args ?? {});
      return parsed.success ? definition.run(grant, parsed.data) : refused(z.prettifyError(parsed.error));
    },
  };
}

export const done = (value: object): ToolResult => ({ kind: 'done', value });
export const refused = (reason: string): ToolResult => ({ kind: 'refused', reason });
