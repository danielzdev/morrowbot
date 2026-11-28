import { z } from 'zod';

/** A tool name a tool plugin exposes (lowercase letters, digits, dashes or underscores). */
export const PluginToolName = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9_-]*$/, 'Use lowercase letters, digits, dashes, or underscores starting with a letter');
export type PluginToolName = z.infer<typeof PluginToolName>;

/** One tool a tool plugin advertises over `tools-list`. */
export const PluginToolDefinition = z.strictObject({
  name: PluginToolName,
  description: z.string().min(1),
  inputSchema: z.record(z.string(), z.unknown()),
});
export type PluginToolDefinition = z.infer<typeof PluginToolDefinition>;

export const ToolImageMimeType = z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export type ToolImageMimeType = z.infer<typeof ToolImageMimeType>;

/** One content block returned by a tool plugin call (text or base64-encoded image). */
export const ToolContentBlock = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), text: z.string() }),
  z.strictObject({ kind: z.literal('image'), mimeType: ToolImageMimeType, data: z.string().min(1) }),
]);
export type ToolContentBlock = z.infer<typeof ToolContentBlock>;

/** What a tool plugin answers a `tool-call` with: content blocks for the model, or an error message. */
export const PluginToolResult = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ok'), content: z.array(ToolContentBlock).min(1) }),
  z.strictObject({ kind: z.literal('error'), message: z.string().min(1) }),
]);
export type PluginToolResult = z.infer<typeof PluginToolResult>;
