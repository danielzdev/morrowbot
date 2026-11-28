import type { PendingApproval, ThreadState } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { applyEvent, endApproval, viewOf, type ThreadEvent, type ThreadView } from './thread-view.ts';

const AT = '2026-01-01T00:00:00.000Z';
const WRITE: PendingApproval = {
  approvalId: 'a1',
  summary: 'Allow writing notes.md?',
  choices: [
    { id: 'deny', label: 'Deny' },
    { id: 'allow', label: 'Allow' },
  ],
};

function state(seq: number, pending: readonly PendingApproval[] | null): ThreadState {
  return {
    thread: { id: 't', agentId: 'a', title: 'Main', createdAt: AT, updatedAt: AT, archivedAt: null },
    messages: [],
    reactions: [],
    toolSteps: [],
    activeTurn: pending === null ? null : { generationId: 'g', trigger: { kind: 'chat' }, state: 'running', queueNote: null, text: '', pendingApprovals: [...pending], toolSteps: [] },
    blockedGroups: [],
    subagents: [],
    queue: [],
    cursor: { hostEpoch: 'e1', seq },
  };
}

type EventBody = ThreadEvent extends infer E ? (E extends ThreadEvent ? Omit<E, 'threadId' | 'generationId' | 'cursor'> : never) : never;

/** Applies events in order after `view`, numbering them from its cursor. */
function play(view: ThreadView, bodies: readonly EventBody[]): ThreadView {
  return bodies.reduce((current, body) => {
    const event = { ...body, threadId: 't', generationId: 'g', cursor: { hostEpoch: 'e1', seq: current.cursor.seq + 1 } };
    const applied = applyEvent(current, event);
    if (applied.kind !== 'applied') throw new Error(`${event.kind} was ${applied.kind}`);
    return applied.view;
  }, view);
}

it('streams a turn: user message, status, deltas, a tool call, then the reply with its steps', () => {
  const view = play(viewOf(state(0, null)), [
    {
      kind: 'generation.started',
      state: 'running',
      userMessage: { kind: 'user', id: 'u1', threadId: 't', text: 'Find tram routes', createdAt: AT, attachments: [] },
    },
    { kind: 'generation.status', state: 'running', queueNote: null, detail: 'Thinking' },
    { kind: 'generation.delta', text: 'Tram 28 ' },
    { kind: 'generation.tool-start', toolUseId: 'x1', name: 'search_notes', input: { query: 'tram' } },
    { kind: 'generation.tool-end', toolUseId: 'x1', outcome: 'ok' },
    { kind: 'generation.delta', text: 'runs east.' },
  ]);
  expect(view.activeTurn).toMatchInlineSnapshot(`
    {
      "detail": "Thinking",
      "generationId": "g",
      "queueNote": null,
      "state": "running",
      "steps": [
        {
          "input": {
            "query": "tram",
          },
          "kind": "tool",
          "name": "search_notes",
          "outcome": "ok",
          "toolUseId": "x1",
        },
      ],
      "text": "Tram 28 runs east.",
      "trigger": {
        "kind": "chat",
      },
    }
  `);
  const done = play(view, [
    {
      kind: 'generation.finished',
      message: { kind: 'assistant', id: 'r1', threadId: 't', text: 'Tram 28 runs east.', createdAt: AT, outcome: { kind: 'completed', finishReason: 'stop' } },
    },
  ]);
  expect({ messages: done.messages.map(({ id, kind }) => `${kind}:${id}`), activeTurn: done.activeTurn, finished: done.finished }).toMatchInlineSnapshot(`
    {
      "activeTurn": null,
      "finished": {
        "r1": [
          {
            "input": {
              "query": "tram",
            },
            "kind": "tool",
            "name": "search_notes",
            "outcome": "ok",
            "toolUseId": "x1",
          },
        ],
      },
      "messages": [
        "user:u1",
        "assistant:r1",
      ],
    }
  `);
});

it('ignores a replayed event and asks for a resync on a gap or a new host run', () => {
  const view = viewOf(state(5, []));
  const event = (seq: number, hostEpoch = 'e1'): ThreadEvent => ({
    kind: 'generation.delta',
    text: 'x',
    threadId: 't',
    generationId: 'g',
    cursor: { hostEpoch, seq },
  });
  expect([applyEvent(view, event(5)).kind, applyEvent(view, event(7)).kind, applyEvent(view, event(6, 'e2')).kind]).toEqual([
    'ignored',
    'resync',
    'resync',
  ]);
});

it('ends an approval card with the chosen label', () => {
  const view = play(viewOf(state(0, [WRITE])), [
    { kind: 'generation.approval-resolved', approvalId: 'a1', resolution: { kind: 'chosen', choiceId: 'allow' } },
  ]);
  expect(view.activeTurn?.steps).toMatchInlineSnapshot(`
    [
      {
        "approval": {
          "approvalId": "a1",
          "choices": [
            {
              "id": "deny",
              "label": "Deny",
            },
            {
              "id": "allow",
              "label": "Allow",
            },
          ],
          "summary": "Allow writing notes.md?",
        },
        "ending": {
          "kind": "chosen",
          "label": "Allow",
        },
        "kind": "approval",
      },
    ]
  `);
});

it('keeps a late answer as late on reload, and clears a card the host no longer lists', () => {
  const second = { ...WRITE, approvalId: 'a2' };
  const before = endApproval(viewOf(state(3, [WRITE, second])), 'a1', { kind: 'late' });
  const reloaded = viewOf(state(4, []), before);
  expect(reloaded.activeTurn?.steps.map((step) => (step.kind === 'approval' ? [step.approval.approvalId, step.ending] : step.kind))).toEqual([
    ['a1', { kind: 'late' }],
    ['a2', { kind: 'cleared' }],
  ]);
});

it('runs a background turn for another agent without a chat bubble, and clears it when it ends quietly', () => {
  const started = play(viewOf(state(0, null)), [
    { kind: 'generation.background-started', agentMessageId: 'am1', state: 'running' },
    { kind: 'generation.delta', text: 'internal notes' },
  ]);
  const ended = play(started, [{ kind: 'generation.background-finished', outcome: { kind: 'completed', finishReason: 'stop' } }]);
  expect({ trigger: started.activeTurn?.trigger, messages: ended.messages.length, activeTurn: ended.activeTurn }).toEqual({
    trigger: { kind: 'agent-message', agentMessageId: 'am1' },
    messages: 0,
    activeTurn: null,
  });
});

it('splits a steered turn: the reply so far is saved, the queued message joins the chat, and the turn goes on', () => {
  const view = play(viewOf(state(0, [])), [
    { kind: 'generation.tool-start', toolUseId: 'x1', name: 'search_notes', input: {} },
    { kind: 'generation.delta', text: 'Looking' },
    {
      kind: 'generation.steered',
      segment: { kind: 'assistant', id: 's1', threadId: 't', text: 'Looking', createdAt: AT, outcome: { kind: 'steered' } },
      userMessage: { kind: 'user', id: 'q1', threadId: 't', text: 'Only trams, please', createdAt: AT, attachments: [] },
    },
    { kind: 'generation.delta', text: 'Tram 28.' },
  ]);
  expect({
    messages: view.messages.map(({ id, kind }) => `${kind}:${id}`),
    text: view.activeTurn?.text,
    segmentSteps: view.finished.s1?.map((step) => (step.kind === 'tool' ? `${step.name}:${step.outcome}` : step.kind)),
  }).toEqual({ messages: ['assistant:s1', 'user:q1'], text: 'Tram 28.', segmentSteps: ['search_notes:unfinished'] });
});
