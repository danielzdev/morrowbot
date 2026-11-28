import { z } from 'zod';
import { EntityId, Timestamp } from './ids.ts';

const ThreadTitle = z.string().trim().min(1).max(200);

export const Thread = z.strictObject({
  id: EntityId,
  agentId: EntityId,
  title: ThreadTitle,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  /** When the chat was archived, or null while active. Older hosts omit it. */
  archivedAt: Timestamp.nullable().default(null),
  /** Host-assigned creation order (`threads.rowid`), breaking same-millisecond ties deterministically. */
  createdSeq: z.number().int().positive().optional(),
});
export type Thread = z.infer<typeof Thread>;

export const CreateThreadRequest = z.strictObject({ title: ThreadTitle.default('New chat') });
export type CreateThreadRequest = z.infer<typeof CreateThreadRequest>;

export const UpdateThreadRequest = z.strictObject({ title: ThreadTitle });
export type UpdateThreadRequest = z.infer<typeof UpdateThreadRequest>;

/** True when `a` was created before `b`, matching the host's `ORDER BY created_at, rowid`. */
export function createdBefore(a: Thread, b: Thread): boolean {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt;
  if (a.createdSeq !== b.createdSeq) {
    if (a.createdSeq === undefined) return false;
    if (b.createdSeq === undefined) return true;
    return a.createdSeq < b.createdSeq;
  }
  return false;
}

/** An agent's main chat: its first active chat by host creation order (`createdAt`, then `createdSeq`). It receives new messages from other agents. */
export function mainThread(threads: readonly Thread[]): Thread | null {
  return threads.reduce<Thread | null>(
    (first, thread) => (thread.archivedAt !== null ? first : first === null || createdBefore(thread, first) ? thread : first),
    null,
  );
}
