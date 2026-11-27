import { z } from 'zod';

/** A request to run one local tool inside the agent's workspace. Paths are relative to the workspace. */
export const ToolCall = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('shell'), command: z.string().min(1) }),
  z.strictObject({ kind: z.literal('read_file'), path: z.string().min(1) }),
  z.strictObject({ kind: z.literal('write_file'), path: z.string().min(1), content: z.string() }),
]);
export type ToolCall = z.infer<typeof ToolCall>;

export const ToolResult = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('shell'),
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
    stdout: z.string(),
    stderr: z.string(),
    truncated: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('read_file'), content: z.string() }),
  z.strictObject({ kind: z.literal('write_file'), bytes: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal('denied'), reason: z.string() }),
  z.strictObject({ kind: z.literal('failed'), error: z.string() }),
  z.strictObject({ kind: z.literal('aborted') }),
]);
export type ToolResult = z.infer<typeof ToolResult>;

/** Local tools bound to one agent's workspace. `run` never throws; problems come back as a result. */
export interface AgentTools {
  run(call: ToolCall, signal?: AbortSignal): Promise<ToolResult>;
}
