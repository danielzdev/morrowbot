import { z } from 'zod';
import { Attachment, MAX_ATTACHMENTS } from './attachments.ts';
import { EntityId, Timestamp } from './ids.ts';
import { TurnOutcome } from './provider.ts';

/** How a reply ended. `steered`: the user's queued message cut in here, and the work went on after it. */
export const GenerationOutcome = z.discriminatedUnion('kind', [...TurnOutcome.options, z.strictObject({ kind: z.literal('steered') })]);
export type GenerationOutcome = z.infer<typeof GenerationOutcome>;

const MessageBase = { id: EntityId, threadId: EntityId, text: z.string(), createdAt: Timestamp };

export const UserMessage = z.strictObject({ kind: z.literal('user'), ...MessageBase, attachments: z.array(Attachment).max(MAX_ATTACHMENTS) });
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
