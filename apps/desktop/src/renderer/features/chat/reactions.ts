import type { MessageReaction } from '@morrowbot/contracts';

/** The emoji the quick picker offers on an agent's reply. */
export const QUICK_REACTIONS: readonly string[] = ['👍', '❤️', '😂', '🎉', '🙏', '👀', '✅'];

/** The thread's reactions with `messageId`'s replaced by `next`. */
export function replaceReactions(all: readonly MessageReaction[], messageId: string, next: readonly MessageReaction[]): readonly MessageReaction[] {
  return [...all.filter((reaction) => reaction.messageId !== messageId), ...next];
}

/** The thread's reactions by message id, each message's in the order they came. */
export function reactionsByMessage(all: readonly MessageReaction[]): ReadonlyMap<string, readonly MessageReaction[]> {
  const by = new Map<string, MessageReaction[]>();
  for (const reaction of all) by.set(reaction.messageId, [...(by.get(reaction.messageId) ?? []), reaction]);
  return by;
}

/** Whether the user's `emoji` is among `reactions`. */
export const userReacted = (reactions: readonly MessageReaction[], emoji: string): boolean =>
  reactions.some((reaction) => reaction.actor === 'user' && reaction.emoji === emoji);
