import type { AgentMessage, Message, ThreadState } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { nextActivity, type ChatActivity } from './activity.ts';
import { readNote } from './agent-exchange.ts';
import { applyEvent, pendingApprovals, viewOf, type ThreadEvent, type ThreadView } from './thread-model.ts';

const AT = '2026-01-01T00:00:00.000Z';
const STATE: ThreadState = {
  thread: { id: 't', agentId: 'a', title: 'Chat', createdAt: AT, updatedAt: AT },
  messages: [],
  reactions: [],
  toolSteps: [],
  activeTurn: {
    generationId: 'g',
    trigger: { kind: 'chat' },
    state: 'running',
    queueNote: null,
    text: 'Hel',
    pendingApprovals: [{ approvalId: 'p', summary: 'Write .git/x', choices: [{ id: 'allow', label: 'Allow' }] }],
    toolSteps: [],
  },
  queue: [],
  blockedGroups: [],
  subagents: [],
  cursor: { hostEpoch: 'e1', seq: 4 },
};

const at = (seq: number, hostEpoch = 'e1') => ({ threadId: 't', generationId: 'g', cursor: { hostEpoch, seq } });

/** Applies events in order, recording what each one did. */
function run(events: readonly ThreadEvent[]): { readonly steps: string[]; readonly view: ThreadView } {
  let view = viewOf(STATE);
  const steps = events.map((event) => {
    const applied = applyEvent(view, event, 0);
    if (applied.kind === 'applied') view = applied.view;
    return `${event.kind}@${event.cursor.hostEpoch}/${String(event.cursor.seq)}: ${applied.kind}`;
  });
  return { steps, view };
}

it('applies only the next event: replays are ignored, a gap or another host run asks for a resync', () => {
  const { steps, view } = run([
    { kind: 'generation.delta', ...at(4), text: 'old' },
    { kind: 'generation.delta', ...at(5), text: 'lo' },
    { kind: 'generation.delta', ...at(5), text: 'lo' },
    { kind: 'generation.delta', ...at(7), text: '!' },
    { kind: 'generation.delta', ...at(6, 'e2'), text: '!' },
    { kind: 'generation.approval-resolved', ...at(6), approvalId: 'p', resolution: { kind: 'expired' } },
    { kind: 'generation.status', ...at(7), state: 'running', queueNote: null, detail: 'Thinking' },
  ]);
  const turn = view.activeTurn;
  const endings = turn?.steps.map((step) => (step.kind === 'approval' ? `${step.approval.summary}: ${step.ending?.kind ?? 'pending'}` : step.name));
  expect({ steps, text: turn?.text, detail: turn?.detail, pending: turn === null ? null : pendingApprovals(turn), endings, cursor: view.cursor }).toMatchInlineSnapshot(`
    {
      "cursor": {
        "hostEpoch": "e1",
        "seq": 7,
      },
      "detail": "Thinking",
      "endings": [
        "Write .git/x: expired",
      ],
      "pending": [],
      "steps": [
        "generation.delta@e1/4: ignored",
        "generation.delta@e1/5: applied",
        "generation.delta@e1/5: ignored",
        "generation.delta@e1/7: resync",
        "generation.delta@e2/6: resync",
        "generation.approval-resolved@e1/6: applied",
        "generation.status@e1/7: applied",
      ],
      "text": "Hello",
    }
  `);
});

it('asks for a resync when an event belongs to a turn the view does not know', () => {
  expect(applyEvent(viewOf({ ...STATE, activeTurn: null }), { kind: 'generation.delta', ...at(5), text: 'x' }, 0)).toMatchInlineSnapshot(`
    {
      "kind": "resync",
    }
  `);
});

it('keeps a background turn out of the messages, notes how it ended early, and never shows it as a completed reply', () => {
  const reply: Message = { kind: 'assistant', attachments: [], id: 'r', threadId: 't', text: 'Earlier reply', outcome: { kind: 'completed', finishReason: 'stop' }, createdAt: AT };
  let view = viewOf({ ...STATE, messages: [reply], activeTurn: null });
  let activity: ChatActivity = 'idle';
  const seen: string[] = [];
  const events: ThreadEvent[] = [
    { kind: 'generation.background-started', ...at(5), agentMessageId: 'm1', state: 'queued' },
    { kind: 'generation.delta', ...at(6), text: 'Draft answer' },
    { kind: 'generation.background-finished', ...at(7), outcome: { kind: 'completed', finishReason: 'stop' } },
    { kind: 'generation.background-started', ...at(8), agentMessageId: 'm2', state: 'running' },
    { kind: 'generation.background-finished', ...at(9), outcome: { kind: 'cancelled' } },
  ];
  for (const event of events) {
    const applied = applyEvent(view, event, 0);
    if (applied.kind !== 'applied') throw new Error(`${event.kind}: ${applied.kind}`);
    activity = nextActivity(activity, applied.view, view);
    view = applied.view;
    seen.push(`${event.kind}: ${activity}, ${view.activeTurn === null ? 'idle' : `${view.activeTurn.trigger.kind} "${view.activeTurn.text}"`}`);
  }
  expect({ seen, messages: view.messages.map(({ id }) => id), quietEnds: view.quietEnds }).toMatchInlineSnapshot(`
    {
      "messages": [
        "r",
      ],
      "quietEnds": {
        "m1": "completed",
        "m2": "cancelled",
      },
      "seen": [
        "generation.background-started: queued, agent-message """,
        "generation.delta: queued, agent-message "Draft answer"",
        "generation.background-finished: idle, idle",
        "generation.background-started: thinking, agent-message """,
        "generation.background-finished: idle, idle",
      ],
    }
  `);
});

it("replaces one message's reactions from an event, even with no turn running, and leaves the others alone", () => {
  const reaction = (messageId: string, actor: 'user' | 'agent', emoji: string) => ({ messageId, actor, emoji, createdAt: AT });
  let view = viewOf({ ...STATE, activeTurn: null, reactions: [reaction('m1', 'agent', '👍'), reaction('m2', 'user', '❤️')] });
  const events: ThreadEvent[] = [
    { kind: 'reactions.changed', threadId: 't', cursor: { hostEpoch: 'e1', seq: 5 }, messageId: 'm2', reactions: [reaction('m2', 'user', '❤️'), reaction('m2', 'user', '🎉')] },
    { kind: 'reactions.changed', threadId: 't', cursor: { hostEpoch: 'e1', seq: 6 }, messageId: 'm1', reactions: [] },
  ];
  for (const event of events) {
    const applied = applyEvent(view, event, 0);
    if (applied.kind !== 'applied') throw new Error(`${event.kind}: ${applied.kind}`);
    view = applied.view;
  }
  expect(view.reactions.map(({ messageId, actor, emoji }) => `${messageId} ${actor} ${emoji}`)).toMatchInlineSnapshot(`
    [
      "m2 user ❤️",
      "m2 user 🎉",
    ]
  `);
});

it('ends a chat turn the agent left quiet without a new message, and does not resync', () => {
  const result = applyEvent(viewOf(STATE), { kind: 'generation.background-finished', ...at(5), outcome: { kind: 'completed', finishReason: 'stop' } }, 0);
  expect(result.kind === 'applied' ? { activeTurn: result.view.activeTurn, messages: result.view.messages, quietEnds: result.view.quietEnds } : result).toMatchInlineSnapshot(`
    {
      "activeTurn": null,
      "messages": [],
      "quietEnds": {},
    }
  `);
});

it('restores saved background read outcomes on cold load and resync for incoming agent messages only', () => {
  const unread: AgentMessage = {
    id: 'm-in',
    from: { agentId: 'peer', threadId: 't-peer' },
    to: { agentId: 'a', threadId: 't' },
    text: 'Check logs',
    expectsReply: false,
    replyToMessageId: null,
    depth: 0,
    createdAt: AT,
  };
  const incoming: AgentMessage = { ...unread, readOutcome: 'failed' };
  const outgoing: AgentMessage = {
    id: 'm-out',
    from: { agentId: 'a', threadId: 't' },
    to: { agentId: 'peer', threadId: 't-peer' },
    text: 'Heads up',
    expectsReply: false,
    replyToMessageId: null,
    depth: 0,
    createdAt: AT,
    readOutcome: 'cancelled',
  };
  const cold = viewOf({ ...STATE, activeTurn: null }, null, [incoming, outgoing]);
  const resynced = viewOf({ ...STATE, activeTurn: null }, viewOf({ ...STATE, activeTurn: null }, null, [unread]), [
    { ...unread, readOutcome: 'interrupted' },
    outgoing,
  ]);
  expect({
    coldKeys: Object.keys(cold.quietEnds),
    coldIncomingNote: readNote(cold.quietEnds['m-in']),
    coldOutgoingNote: readNote(cold.quietEnds['m-out']),
    resyncedNote: readNote(resynced.quietEnds['m-in']),
  }).toMatchInlineSnapshot(`
    {
      "coldIncomingNote": "Failed while reading",
      "coldKeys": [
        "m-in",
      ],
      "coldOutgoingNote": null,
      "resyncedNote": "Interrupted while reading",
    }
  `);
});
