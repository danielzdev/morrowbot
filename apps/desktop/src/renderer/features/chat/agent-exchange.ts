import type { AgentMessage, Message } from '@morrowbot/contracts';

/** One row of the timeline: a chat message, or the agent messages that arrived between two chat messages. */
export type TimelineItem =
  | { readonly kind: 'message'; readonly message: Message }
  | { readonly kind: 'exchange'; readonly messages: readonly AgentMessage[] };

/**
 * The chat messages from `start` on, each run of agent messages between them grouped into one exchange.
 * Agent messages from before the first shown chat message stay hidden with it until "Show earlier".
 */
export function timelineItems(messages: readonly Message[], agentMessages: readonly AgentMessage[], start: number): TimelineItem[] {
  const shown = messages.slice(start);
  const from = start > 0 ? shown[0]?.createdAt : undefined;
  const pending = agentMessages.filter(({ createdAt }) => from === undefined || createdAt >= from);
  const items: TimelineItem[] = [];
  let next = 0;
  const flushUntil = (before: string | undefined): void => {
    const run: AgentMessage[] = [];
    while (next < pending.length) {
      const candidate = pending[next];
      if (candidate === undefined || (before !== undefined && candidate.createdAt >= before)) break;
      run.push(candidate);
      next += 1;
    }
    if (run.length > 0) items.push({ kind: 'exchange', messages: run });
  };
  for (const message of shown) {
    flushUntil(message.createdAt);
    items.push({ kind: 'message', message });
  }
  flushUntil(undefined);
  return items;
}

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
