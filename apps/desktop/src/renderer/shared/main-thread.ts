import type { Thread } from '@morrowbot/contracts';

/** An agent's main chat: its first, by creation time. It shows under the agent's name and is opened when no other chat is. */
export function mainThread(threads: readonly Thread[]): Thread | null {
  return threads.reduce<Thread | null>((first, thread) => (first === null || thread.createdAt < first.createdAt ? thread : first), null);
}
