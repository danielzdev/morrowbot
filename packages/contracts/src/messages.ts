import { z } from 'zod';
import { EntityId, Timestamp } from './ids.ts';

export const GenerationOutcome = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('completed') }),
  z.strictObject({ kind: z.literal('stopped') }),
  z.strictObject({ kind: z.literal('failed'), error: z.string() }),
]);
export type GenerationOutcome = z.infer<typeof GenerationOutcome>;

const MessageBase = { id: EntityId, threadId: EntityId, text: z.string(), createdAt: Timestamp };

export const UserMessage = z.strictObject({ kind: z.literal('user'), ...MessageBase });
export type UserMessage = z.infer<typeof UserMessage>;

export const AssistantMessage = z.strictObject({ kind: z.literal('assistant'), ...MessageBase, outcome: GenerationOutcome });
export type AssistantMessage = z.infer<typeof AssistantMessage>;

export const Message = z.discriminatedUnion('kind', [UserMessage, AssistantMessage]);
export type Message = z.infer<typeof Message>;
