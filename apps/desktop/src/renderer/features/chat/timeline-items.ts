import type { AgentMessage, Message, SubagentRun } from '@morrowbot/contracts';

/**
 * One row of the timeline: a chat message, the agent messages that arrived between two chat messages, or the
 * sub-agents a turn started between them.
 */
export type TimelineItem =
  | { readonly kind: 'message'; readonly message: Message }
  | { readonly kind: 'exchange'; readonly messages: readonly AgentMessage[] }
  | { readonly kind: 'subagents'; readonly runs: readonly SubagentRun[] };

type Aside = { readonly kind: 'exchange'; readonly message: AgentMessage } | { readonly kind: 'subagents'; readonly run: SubagentRun };

const atOf = (aside: Aside): string => (aside.kind === 'exchange' ? aside.message.createdAt : aside.run.createdAt);

/**
 * The chat messages from `start` on, each run of agent messages or sub-agents between them grouped into one
 * item. Those from before the first shown chat message stay hidden with it until "Show earlier".
 */
export function timelineItems(messages: readonly Message[], agentMessages: readonly AgentMessage[], subagents: readonly SubagentRun[], start: number): TimelineItem[] {
  const shown = messages.slice(start);
  const from = start > 0 ? shown[0]?.createdAt : undefined;
  const asides: Aside[] = [
    ...agentMessages.map((message): Aside => ({ kind: 'exchange', message })),
    ...subagents.map((run): Aside => ({ kind: 'subagents', run })),
  ]
    .filter((aside) => from === undefined || atOf(aside) >= from)
    .sort((a, b) => (atOf(a) < atOf(b) ? -1 : atOf(a) > atOf(b) ? 1 : 0));
  const items: TimelineItem[] = [];
  let next = 0;
  const flushUntil = (before: string | undefined): void => {
    while (next < asides.length) {
      const aside = asides[next];
      if (aside === undefined || (before !== undefined && atOf(aside) >= before)) break;
      next += 1;
      const last = items.at(-1);
      switch (aside.kind) {
        case 'exchange':
          if (last?.kind === 'exchange') items[items.length - 1] = { kind: 'exchange', messages: [...last.messages, aside.message] };
          else items.push({ kind: 'exchange', messages: [aside.message] });
          break;
        case 'subagents':
          if (last?.kind === 'subagents') items[items.length - 1] = { kind: 'subagents', runs: [...last.runs, aside.run] };
          else items.push({ kind: 'subagents', runs: [aside.run] });
          break;
      }
    }
  };
  for (const message of shown) {
    flushUntil(message.createdAt);
    items.push({ kind: 'message', message });
  }
  flushUntil(undefined);
  return items;
}
