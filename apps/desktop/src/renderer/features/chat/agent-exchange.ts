import { MAX_EXCHANGE_MESSAGES, type AgentMessage, type TurnOutcome } from '@morrowbot/contracts';

export type Direction = 'outgoing' | 'incoming';

/** What a collapsed exchange says about itself, as the chat's own agent sees it. */
export type ExchangeSummary =
  | { readonly kind: 'single'; readonly verb: string; readonly peerId: string; readonly at: string }
  | { readonly kind: 'burst'; readonly count: number; readonly peerIds: readonly string[]; readonly at: string };

export function directionOf(message: AgentMessage, threadId: string): Direction {
  return message.from.threadId === threadId ? 'outgoing' : 'incoming';
}

function verbOf(message: AgentMessage, direction: Direction): string {
  const reply = message.replyToMessageId !== null;
  switch (direction) {
    case 'outgoing':
      return reply ? 'Replied to' : message.expectsReply ? 'Asked' : 'Informed';
    case 'incoming':
      return reply ? 'Reply from' : message.expectsReply ? 'Question from' : 'Update from';
  }
}

const peerOf = (message: AgentMessage, threadId: string): string =>
  directionOf(message, threadId) === 'outgoing' ? message.to.agentId : message.from.agentId;

/** The collapsed line of an exchange shown in chat `threadId`. */
export function summarize(messages: readonly AgentMessage[], threadId: string): ExchangeSummary | null {
  const [first] = messages;
  const last = messages.at(-1);
  if (first === undefined || last === undefined) return null;
  if (messages.length === 1) return { kind: 'single', verb: verbOf(first, directionOf(first, threadId)), peerId: peerOf(first, threadId), at: first.createdAt };
  return { kind: 'burst', count: messages.length, peerIds: [...new Set(messages.map((message) => peerOf(message, threadId)))], at: last.createdAt };
}

/** The small line under an expanded message: whether it waits on an answer. */
export function replyNote(message: AgentMessage): string {
  if (message.expectsReply) return 'Expects a reply';
  return message.replyToMessageId === null ? 'No reply needed' : 'Reply';
}

/** The quiet line of a background turn reading `message` (undefined while it is not loaded). */
export function backgroundVerb(message: AgentMessage | undefined): string {
  if (message === undefined) return 'Reading a message';
  return message.expectsReply && message.depth + 1 < MAX_EXCHANGE_MESSAGES ? 'Replying to' : 'Reading a message from';
}

/** What a received message's card says when the background turn reading it ended early; null when it finished. */
export function readNote(outcome: TurnOutcome | undefined): string | null {
  switch (outcome?.kind) {
    case undefined:
    case 'completed':
      return null;
    case 'cancelled':
      return 'Stopped while reading';
    case 'interrupted':
      return 'Interrupted while reading';
    case 'failed':
      return 'Failed while reading';
  }
}
