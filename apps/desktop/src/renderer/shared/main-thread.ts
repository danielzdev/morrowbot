import type { Thread } from '@morrowbot/contracts';

const earlier = (a: Thread, b: Thread): boolean => a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id);

/** An agent's main chat: its first by creation time (then id, so ties never flip). It shows under the agent's name and is opened when no other chat is. */
export function mainThread(threads: readonly Thread[]): Thread | null {
  return threads.reduce<Thread | null>((first, thread) => (first === null || earlier(thread, first) ? thread : first), null);
}
