import { z } from 'zod';
import { EntityId, Timestamp } from './ids.ts';

let rgiEmoji: RegExp | null | undefined;

/**
 * Whether `text` is exactly one complete (fully-qualified) Unicode emoji: 👍, ❤️, 👍🏽, 🧑‍💻 or 🇯🇵, but not ❤
 * without its emoji form, two emoji, or emoji with text. An engine without the RegExp `v` flag (some mobile
 * runtimes) accepts any non-empty text: the host, on Node, always checks.
 */
export function isSingleEmoji(text: string): boolean {
  if (rgiEmoji === undefined) {
    try {
      rgiEmoji = new RegExp('^\\p{RGI_Emoji}$', 'v');
    } catch {
      rgiEmoji = null;
    }
  }
  return rgiEmoji === null ? text !== '' : rgiEmoji.test(text);
}

export const Emoji = z
  .string()
  .max(64)
  .refine((text) => isSingleEmoji(text), { error: 'Use one complete emoji, such as 👍 or ❤️' });
export type Emoji = z.infer<typeof Emoji>;

/** Who reacted: the user, to the agent's replies, or the chat's agent, to the user's messages. */
export const ReactionActor = z.enum(['user', 'agent']);
export type ReactionActor = z.infer<typeof ReactionActor>;

/** One emoji on one message. Each actor puts a given emoji on a message at most once. */
export const MessageReaction = z.strictObject({ messageId: EntityId, actor: ReactionActor, emoji: Emoji, createdAt: Timestamp });
export type MessageReaction = z.infer<typeof MessageReaction>;

/**
 * Sets whether the user's `emoji` is on the agent's reply `messageId`. Adding one also tells the agent, in a turn
 * of its own once the chat is idle: it may act on it (a go-ahead) or end that turn quietly.
 */
export const SetReactionRequest = z.strictObject({ messageId: EntityId, emoji: Emoji, reacted: z.boolean() });
export type SetReactionRequest = z.infer<typeof SetReactionRequest>;

/** The message's reactions after the change, oldest first. */
export const SetReactionResponse = z.strictObject({ reactions: z.array(MessageReaction) });
export type SetReactionResponse = z.infer<typeof SetReactionResponse>;

/**
 * Settings › Chat › Emoji-only / silent replies: whether agents may answer with only an emoji reaction, or with
 * nothing, instead of a text reply. `per_agent` leaves it to each agent's own setting.
 */
export const EmojiRepliesSetting = z.enum(['per_agent', 'all', 'off']);
export type EmojiRepliesSetting = z.infer<typeof EmojiRepliesSetting>;

/** Agent Settings › Emoji-only / silent replies, used while the global setting is `per_agent`. */
export const AgentEmojiReplies = z.enum(['allowed', 'off']);
export type AgentEmojiReplies = z.infer<typeof AgentEmojiReplies>;

/** What applies to one agent: the global setting, unless it leaves the choice to the agent. */
export function effectiveEmojiReplies(global: EmojiRepliesSetting, agent: AgentEmojiReplies): AgentEmojiReplies {
  switch (global) {
    case 'all':
      return 'allowed';
    case 'off':
      return 'off';
    case 'per_agent':
      return agent;
  }
}

/** The host's chat settings (Settings › Chat), shared by every window and device. */
export const ChatSettings = z.strictObject({ emojiReplies: EmojiRepliesSetting });
export type ChatSettings = z.infer<typeof ChatSettings>;
