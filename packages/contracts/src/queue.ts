import { z } from 'zod';
import { Attachment, MAX_ATTACHMENTS } from './attachments.ts';
import { EntityId, Timestamp } from './ids.ts';

/**
 * Where a message sent during a running turn is. `queued`: the agent has not seen it; it runs as the
 * next turn. `steering`: Steer now was pressed and it is on its way into the running turn (`native`)
 * or the turn is being interrupted for it (`interrupt`). `held`: it was not sent and waits for the user.
 */
export const QueuedMessageState = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('queued') }),
  z.strictObject({ kind: z.literal('steering'), via: z.enum(['native', 'interrupt']) }),
  z.strictObject({ kind: z.literal('held'), reason: z.string().min(1) }),
]);
export type QueuedMessageState = z.infer<typeof QueuedMessageState>;

export const QueuedText = z.string().max(1_000_000);

/** A message the agent has not seen yet. Once delivered it becomes a user message with the same id. */
export const QueuedMessage = z.strictObject({
  id: EntityId,
  threadId: EntityId,
  text: QueuedText,
  /** Files attached to this queued message, in send order (older hosts omit it). */
  attachments: z.array(Attachment).max(MAX_ATTACHMENTS).default([]),
  createdAt: Timestamp,
  state: QueuedMessageState,
});
export type QueuedMessage = z.infer<typeof QueuedMessage>;
