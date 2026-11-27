import { z } from 'zod';
import { Agent } from './agents.ts';
import { EntityId } from './ids.ts';
import { AssistantMessage, Message, UserMessage } from './messages.ts';
import { PluginManifest } from './plugin-manifest.ts';
import { Thread } from './threads.ts';
import { ToolCall, ToolResult } from './tools.ts';

export const ApiError = z.strictObject({
  error: z.strictObject({
    kind: z.enum(['invalid_request', 'not_found', 'conflict', 'forbidden', 'internal']),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const AgentList = z.strictObject({ agents: z.array(Agent) });
export type AgentList = z.infer<typeof AgentList>;

export const ThreadList = z.strictObject({ threads: z.array(Thread) });
export type ThreadList = z.infer<typeof ThreadList>;

export const MessageList = z.strictObject({ messages: z.array(Message) });
export type MessageList = z.infer<typeof MessageList>;

export const SendMessageRequest = z.strictObject({ text: z.string().min(1).max(1_000_000) });
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

export const SendMessageResponse = z.strictObject({ generationId: EntityId, userMessage: UserMessage });
export type SendMessageResponse = z.infer<typeof SendMessageResponse>;

export const StopGenerationResponse = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('stopped'), message: AssistantMessage }),
  z.strictObject({ kind: z.literal('idle') }),
]);
export type StopGenerationResponse = z.infer<typeof StopGenerationResponse>;

export const PluginConfig = z.record(z.string(), z.json());
export type PluginConfig = z.infer<typeof PluginConfig>;

export const PluginEntry = z.strictObject({ manifest: PluginManifest, enabled: z.boolean(), config: PluginConfig });
export type PluginEntry = z.infer<typeof PluginEntry>;

export const PluginList = z.strictObject({ plugins: z.array(PluginEntry) });
export type PluginList = z.infer<typeof PluginList>;

export const SetPluginEnabledRequest = z.strictObject({ enabled: z.boolean() });
export type SetPluginEnabledRequest = z.infer<typeof SetPluginEnabledRequest>;

export const SetPluginConfigRequest = z.strictObject({ config: PluginConfig });
export type SetPluginConfigRequest = z.infer<typeof SetPluginConfigRequest>;

const GenerationRef = { threadId: EntityId, generationId: EntityId };

/** Events the host pushes on the `/api/events` WebSocket. */
export const ChatEvent = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('generation.started'), ...GenerationRef, userMessage: UserMessage }),
  z.strictObject({ kind: z.literal('generation.delta'), ...GenerationRef, text: z.string() }),
  z.strictObject({ kind: z.literal('generation.tool'), ...GenerationRef, call: ToolCall, result: ToolResult }),
  z.strictObject({ kind: z.literal('generation.finished'), ...GenerationRef, message: AssistantMessage }),
]);
export type ChatEvent = z.infer<typeof ChatEvent>;
