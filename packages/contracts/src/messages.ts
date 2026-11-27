import { z } from 'zod';
import { EntityId, Timestamp } from './ids.ts';
import { TurnOutcome } from './provider.ts';

export const GenerationOutcome = TurnOutcome;
export type GenerationOutcome = TurnOutcome;

const MessageBase = { id: EntityId, threadId: EntityId, text: z.string(), createdAt: Timestamp };

export const UserMessage = z.strictObject({ kind: z.literal('user'), ...MessageBase });
export type UserMessage = z.infer<typeof UserMessage>;

export const AssistantMessage = z.strictObject({
  kind: z.literal('assistant'),
  ...MessageBase,
  outcome: GenerationOutcome,
  /** Set when older messages were left out of the history sent with this turn. */
  seedTruncated: z.literal(true).optional(),
});
export type AssistantMessage = z.infer<typeof AssistantMessage>;

export const Message = z.discriminatedUnion('kind', [UserMessage, AssistantMessage]);
export type Message = z.infer<typeof Message>;
