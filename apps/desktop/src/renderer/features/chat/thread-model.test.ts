import type { Message, ThreadState } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { nextActivity, type ChatActivity } from './activity.ts';
import { applyEvent, pendingApprovals, viewOf, type ThreadEvent, type ThreadView } from './thread-model.ts';

const AT = '2026-01-01T00:00:00.000Z';
const STATE: ThreadState = {
  thread: { id: 't', agentId: 'a', title: 'Chat', createdAt: AT, updatedAt: AT },
  messages: [],
  activeTurn: {
    generationId: 'g',
    trigger: { kind: 'chat' },
    state: 'running',
    queueNote: null,
    text: 'Hel',
    pendingApprovals: [{ approvalId: 'p', summary: 'Write .git/x', choices: [{ id: 'allow', label: 'Allow' }] }],
  },
  queue: [],
  blockedGroups: [],
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
  const reply: Message = { kind: 'assistant', id: 'r', threadId: 't', text: 'Earlier reply', outcome: { kind: 'completed', finishReason: 'stop' }, createdAt: AT };
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
        "m1": {
          "finishReason": "stop",
          "kind": "completed",
        },
        "m2": {
          "kind": "cancelled",
        },
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
