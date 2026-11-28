import type { AssistantMessage, ThreadCard, ThreadState } from '@morrowbot/contracts';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { applyEvent, viewOf, type ThreadEvent, type ThreadView } from './thread-model.ts';
import { ThreadCards, type CardContext } from './ThreadCards.tsx';

const AT = '2026-01-01T00:00:00.000Z';
const REPLY: AssistantMessage = { kind: 'assistant', id: 'm1', threadId: 't', text: 'Here you go.', createdAt: AT, outcome: { kind: 'completed', finishReason: 'stop' }, attachments: [] };
const card = (id: string, generationId: string, revision: number, answer: string | null = null): ThreadCard => ({
  id,
  threadId: 't',
  generationId,
  messageId: null,
  agentId: 'a',
  createdAt: AT,
  revision,
  body: {
    kind: 'custom',
    ui: { fallbackText: 'Pick one', blocks: [{ kind: 'text', text: '<b>Pick</b> one' }, { kind: 'choices', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] }] },
    answer,
  },
});

const running: ThreadState = {
  thread: { id: 't', agentId: 'a', title: 'Chat', createdAt: AT, updatedAt: AT, archivedAt: null },
  messages: [],
  reactions: [],
  toolSteps: [],
  activeTurn: { generationId: 'g', trigger: { kind: 'chat' }, state: 'running', queueNote: null, text: '', pendingApprovals: [], toolSteps: [] },
  queue: [],
  blockedGroups: [],
  subagents: [],
  cursor: { hostEpoch: 'e', seq: 0 },
};

type Body = ThreadEvent extends infer E ? (E extends ThreadEvent ? Omit<E, 'threadId' | 'cursor'> : never) : never;

function apply(view: ThreadView, bodies: readonly Body[]): ThreadView {
  return bodies.reduce((current, body) => {
    const applied = applyEvent(current, { ...body, threadId: 't', cursor: { hostEpoch: 'e', seq: current.cursor.seq + 1 } }, 0);
    if (applied.kind !== 'applied') throw new Error(`${body.kind}: ${applied.kind}`);
    return applied.view;
  }, view);
}

const where = (view: ThreadView): string[] => view.cards.map((each) => `${each.id} r${String(each.revision)} ${each.messageId ?? 'staged'} ${each.body.kind === 'custom' ? (each.body.answer ?? '-') : ''}`);

it('puts a turn’s staged cards on its reply, keeps the newest copy of each, and drops them with a turn that saved none', () => {
  const staged = apply(viewOf(running), [{ kind: 'card.changed', card: card('c1', 'g', 0) }]);
  const finished = apply(staged, [{ kind: 'generation.finished', generationId: 'g', message: REPLY }]);
  const clicked = apply(finished, [{ kind: 'card.changed', card: { ...card('c1', 'g', 1, 'yes'), messageId: 'm1' } }]);
  const replayedOlder = apply(clicked, [{ kind: 'card.changed', card: card('c1', 'g', 0) }]);
  const quiet = apply(viewOf({ ...running, activeTurn: { generationId: 'q', trigger: { kind: 'chat' }, state: 'running', queueNote: null, text: '', pendingApprovals: [], toolSteps: [] } }, null, [], replayedOlder.cards), [
    { kind: 'card.changed', card: card('c2', 'q', 0) },
    { kind: 'generation.background-finished', generationId: 'q', outcome: { kind: 'completed', finishReason: 'stop' } },
  ]);
  expect({ staged: where(staged), finished: where(finished), clicked: where(clicked), replayedOlder: where(replayedOlder), quiet: where(quiet) }).toMatchInlineSnapshot(`
    {
      "clicked": [
        "c1 r1 m1 yes",
      ],
      "finished": [
        "c1 r0 m1 -",
      ],
      "quiet": [
        "c1 r1 m1 yes",
      ],
      "replayedOlder": [
        "c1 r1 m1 yes",
      ],
      "staged": [
        "c1 r0 staged -",
      ],
    }
  `);
});

it('links only the cards staged before a steer to its segment, even when the snapshot already holds a later one', () => {
  const LATER = '2026-01-01T00:00:05.000Z';
  const segment: AssistantMessage = { ...REPLY, id: 'seg', createdAt: '2026-01-01T00:00:02.000Z', outcome: { kind: 'steered' } };
  const snapshot = viewOf(running, null, [], [card('before', 'g', 0), { ...card('after', 'g', 0), createdAt: LATER }]);
  const steered = apply(snapshot, [
    { kind: 'generation.steered', generationId: 'g', segment, userMessage: { kind: 'user', id: 'u2', threadId: 't', text: 'also this', createdAt: segment.createdAt, attachments: [] } },
  ]);
  const finished = apply(steered, [{ kind: 'generation.finished', generationId: 'g', message: { ...REPLY, id: 'm2', createdAt: LATER } }]);
  expect({ steered: where(steered), finished: where(finished) }).toMatchInlineSnapshot(`
    {
      "finished": [
        "before r0 seg -",
        "after r0 m2 -",
      ],
      "steered": [
        "before r0 seg -",
        "after r0 staged -",
      ],
    }
  `);
});

const CTX: CardContext = {
  peers: { name: () => 'Helper', color: () => '#6b7280', avatar: () => null },
  owner: true,
  onAct: () => undefined,
  onOpenPlugin: null,
};

it('draws an agent card in a frame naming the agent, with its text as text and its choices never in the primary style', () => {
  const html = renderToString(h(ThreadCards, { cards: [{ ...card('c1', 'g', 0), messageId: 'm1' }], staged: false, acting: [], offline: false, ctx: CTX }));
  expect(html.replace(/></g, '>\n<')).toMatchInlineSnapshot(`
    "<div class="thread-cards">
    <section class="agent-card" aria-label="Card from Helper" data-card-id="c1">
    <header class="agent-card-frame">
    <span class="agent-card-avatar" aria-hidden="true">
    </span>
    <span class="agent-card-from">Helper</span>
    <span class="agent-card-kind">Agent card</span>
    </header>
    <div class="agent-card-body">
    <p class="ui-text">&lt;b>Pick&lt;/b> one</p>
    <div class="ui-choices">
    <div class="card-actions" role="group" aria-label="Choices">
    <button type="button" class="secondary">Yes</button>
    <button type="button" class="secondary">No</button>
    </div>
    </div>
    </div>
    </section>
    </div>"
  `);
});
