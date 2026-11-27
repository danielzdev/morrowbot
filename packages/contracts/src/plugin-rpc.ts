import { z } from 'zod';
import { PluginKind } from './plugin-manifest.ts';
import { PluginConfig } from './plugin-settings.ts';

/**
 * The messages the host and a plugin process exchange over the Node IPC channel.
 * Every request carries an `id`; the plugin answers it with exactly one matching
 * result or `error` (a stream sends `stream-chunk`s first).
 */
export const RequestId = z.number().int().nonnegative();

export const ChatMessage = z.strictObject({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const ProviderStreamRequest = z.strictObject({ messages: z.array(ChatMessage) });
export type ProviderStreamRequest = z.infer<typeof ProviderStreamRequest>;

export const StreamChunk = z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('text'), text: z.string() })]);
export type StreamChunk = z.infer<typeof StreamChunk>;

export const FinishReason = z.enum(['stop', 'length', 'cancelled']);
export type FinishReason = z.infer<typeof FinishReason>;

export const PluginHealth = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ok') }),
  z.strictObject({ kind: z.literal('degraded'), detail: z.string().min(1) }),
]);
export type PluginHealth = z.infer<typeof PluginHealth>;

export const HostMessage = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('init'), id: RequestId, config: PluginConfig }),
  z.strictObject({ kind: z.literal('health'), id: RequestId }),
  z.strictObject({ kind: z.literal('shutdown'), id: RequestId }),
  z.strictObject({ kind: z.literal('stream'), id: RequestId, request: ProviderStreamRequest }),
  z.strictObject({ kind: z.literal('cancel'), id: RequestId }),
]);
export type HostMessage = z.infer<typeof HostMessage>;

export const PluginErrorCode = z.enum(['unsupported', 'failed']);
export type PluginErrorCode = z.infer<typeof PluginErrorCode>;

export const PluginMessage = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('init-result'), id: RequestId, pluginKind: PluginKind }),
  z.strictObject({ kind: z.literal('health-result'), id: RequestId, health: PluginHealth }),
  z.strictObject({ kind: z.literal('shutdown-result'), id: RequestId }),
  z.strictObject({ kind: z.literal('stream-chunk'), id: RequestId, chunk: StreamChunk }),
  z.strictObject({ kind: z.literal('stream-end'), id: RequestId, finishReason: FinishReason }),
  z.strictObject({ kind: z.literal('error'), id: RequestId, code: PluginErrorCode, message: z.string() }),
]);
export type PluginMessage = z.infer<typeof PluginMessage>;
