import { z } from 'zod';
import { EntityId, Timestamp } from './ids.ts';

const ThreadTitle = z.string().trim().min(1).max(200);

export const Thread = z.strictObject({
  id: EntityId,
  agentId: EntityId,
  title: ThreadTitle,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Thread = z.infer<typeof Thread>;

export const CreateThreadRequest = z.strictObject({ title: ThreadTitle.default('New chat') });
export type CreateThreadRequest = z.infer<typeof CreateThreadRequest>;

export const UpdateThreadRequest = z.strictObject({ title: ThreadTitle });
export type UpdateThreadRequest = z.infer<typeof UpdateThreadRequest>;
