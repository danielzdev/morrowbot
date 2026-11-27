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

const earlier = (a: Thread, b: Thread): boolean => a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id);

/** An agent's main chat: its first by creation time (then id, so ties never flip). It receives new messages from other agents. */
export function mainThread(threads: readonly Thread[]): Thread | null {
  return threads.reduce<Thread | null>((first, thread) => (first === null || earlier(thread, first) ? thread : first), null);
}
