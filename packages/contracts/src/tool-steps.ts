import { z } from 'zod';
import { EntityId, Timestamp } from './ids.ts';

const ToolStepBase = { toolUseId: z.string().min(1), name: z.string().min(1), input: z.json(), startedAt: Timestamp };

/** One tool call of a turn, as the host saw it. `unfinished`: the turn ended, or was steered, with no end for it. */
export const ToolStep = z.discriminatedUnion('outcome', [
  z.strictObject({ ...ToolStepBase, outcome: z.literal('running') }),
  z.strictObject({ ...ToolStepBase, outcome: z.enum(['ok', 'error']), endedAt: Timestamp }),
  z.strictObject({ ...ToolStepBase, outcome: z.literal('unfinished') }),
]);
export type ToolStep = z.infer<typeof ToolStep>;

/** The tool calls behind one saved reply, oldest first. */
export const MessageToolSteps = z.strictObject({ messageId: EntityId, steps: z.array(ToolStep).min(1) });
export type MessageToolSteps = z.infer<typeof MessageToolSteps>;
