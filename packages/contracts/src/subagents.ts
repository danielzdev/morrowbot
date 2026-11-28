import { z } from 'zod';
import { BoundProvider } from './agents.ts';
import { EntityId, Timestamp } from './ids.ts';
import { GenerationOutcome } from './messages.ts';

/** The most sub-agents one turn may have queued or running at once. */
export const MAX_ACTIVE_SUBAGENTS = 4;
/** The most sub-agents one turn may start in all. */
export const MAX_SUBAGENTS_PER_TURN = 12;

export const SubagentRole = z.string().trim().min(1).max(80);

/** Where a sub-agent's one turn is: waiting for a slot, running, or ended with its reply. */
export const SubagentStatus = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('queued'), queueNote: z.string().min(1).nullable() }),
  z.strictObject({ kind: z.literal('running') }),
  z.strictObject({ kind: z.literal('finished'), outcome: GenerationOutcome, reply: z.string(), finishedAt: Timestamp }),
]);
export type SubagentStatus = z.infer<typeof SubagentStatus>;

/**
 * A sub-agent: one background turn an agent's turn started, on the same or another provider, with at most the
 * parent's access. `id` is its own hidden chat, which keeps the prompt and reply. It never outlives the parent turn.
 */
export const SubagentRun = z.strictObject({
  id: EntityId,
  parentThreadId: EntityId,
  parentGenerationId: EntityId,
  role: SubagentRole,
  binding: BoundProvider,
  prompt: z.string(),
  status: SubagentStatus,
  createdAt: Timestamp,
});
export type SubagentRun = z.infer<typeof SubagentRun>;
