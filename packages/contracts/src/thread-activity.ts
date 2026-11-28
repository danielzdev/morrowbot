import { z } from 'zod';
import { LastMessage } from './agents.ts';
import { Thread } from './threads.ts';

/**
 * What a thread is doing on the host right now. `failed`: no turn runs and the thread's newest message is a reply
 * that failed. Whether a reply is unread is up to each device, so it is not here.
 */
export const ThreadActivity = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('idle') }),
  z.strictObject({ kind: z.literal('queued') }),
  z.strictObject({ kind: z.literal('working') }),
  z.strictObject({ kind: z.literal('needs-approval'), summary: z.string().min(1) }),
  z.strictObject({ kind: z.literal('failed') }),
]);
export type ThreadActivity = z.infer<typeof ThreadActivity>;

/** A thread with what it is doing and its newest message with text (null before it has one). */
export const ThreadSummary = z.strictObject({ thread: Thread, activity: ThreadActivity, lastMessage: LastMessage.nullable() });
export type ThreadSummary = z.infer<typeof ThreadSummary>;

/** `GET /api/threads`: every thread the viewer may see, most recently changed first. */
export const ThreadSummaryList = z.strictObject({ threads: z.array(ThreadSummary) });
export type ThreadSummaryList = z.infer<typeof ThreadSummaryList>;

/** Global `/api/events` frame: a thread was created or renamed, got a message, or its activity changed. */
export const ThreadChanged = z.strictObject({ kind: z.literal('thread.changed'), summary: ThreadSummary });
export type ThreadChanged = z.infer<typeof ThreadChanged>;
