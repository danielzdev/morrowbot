import type { AssistantMessage, PendingApproval, ThreadState } from '@morrowbot/contracts';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { ApprovalCard } from './ApprovalCard.tsx';
import { applyEvent, endApproval, viewOf, type ApprovalStep, type ThreadEvent, type ThreadView } from './thread-model.ts';

const AT = '2026-01-01T00:00:00.000Z';
const EDIT: PendingApproval = {
  approvalId: 'a1',
  summary: 'Allow edit to `.git/config`?',
  choices: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }],
};
const SECOND: PendingApproval = { ...EDIT, approvalId: 'a2', summary: 'Allow write to notes.md?' };

function state(pending: readonly PendingApproval[], seq: number, generationId: string | null = 'g'): ThreadState {
  return {
    thread: { id: 't', agentId: 'a', title: 'Chat', createdAt: AT, updatedAt: AT },
    messages: [],
    activeTurn: generationId === null ? null : { generationId, trigger: { kind: 'chat' }, state: 'running', queueNote: null, text: '', pendingApprovals: [...pending] },
    queue: [],
    blockedGroups: [],
    cursor: { hostEpoch: 'e1', seq },
  };
}

/** A thread event without the fields every event of turn `g` shares. */
type EventBody = ThreadEvent extends infer E ? (E extends Exclude<ThreadEvent, { kind: 'queue.changed' }> ? Omit<E, 'threadId' | 'generationId' | 'cursor'> : never) : never;

/** Applies events after `view`, numbering them from its cursor. */
function apply(view: ThreadView, bodies: readonly EventBody[]): ThreadView {
  let current = view;
  for (const body of bodies) {
    const event: ThreadEvent = { ...body, threadId: 't', generationId: 'g', cursor: { hostEpoch: 'e1', seq: current.cursor.seq + 1 } };
    const applied = applyEvent(current, event, 1_000);
    if (applied.kind !== 'applied') throw new Error(`${body.kind}: ${applied.kind}`);
    current = applied.view;
  }
  return current;
}

const endings = (view: ThreadView, messageId?: string): Record<string, string> => {
  const steps = messageId === undefined ? (view.activeTurn?.steps ?? []) : (view.finished[messageId]?.steps ?? []);
  return Object.fromEntries(steps.flatMap((step) => (step.kind === 'approval' ? [[step.approval.approvalId, step.ending === null ? 'pending' : JSON.stringify(step.ending)]] : [])));
};

const REPLY: AssistantMessage = { kind: 'assistant', id: 'm2', threadId: 't', text: 'Done', createdAt: AT, outcome: { kind: 'completed', finishReason: 'stop' } };

it('ends each request from the host: chosen, expired, cleared with the turn, or vanished during a resync', () => {
  const asked = apply(viewOf(state([], 1)), [
    { kind: 'generation.approval-requested', approval: EDIT },
    { kind: 'generation.approval-requested', approval: SECOND },
  ]);
  const chosen = apply(asked, [{ kind: 'generation.approval-resolved', approvalId: 'a1', resolution: { kind: 'chosen', choiceId: 'deny' } }]);
  const expired = apply(asked, [{ kind: 'generation.approval-resolved', approvalId: 'a2', resolution: { kind: 'expired' } }]);
  const finished = apply(asked, [{ kind: 'generation.finished', message: REPLY }]);
  const vanished = viewOf(state([SECOND], 9), asked);
  const reconnected = viewOf(state([EDIT, SECOND], 2), viewOf(state([EDIT, SECOND], 2)));
  const late = endApproval(asked, 'a1', { kind: 'late' });
  expect({
    asked: endings(asked),
    chosen: endings(chosen),
    expired: endings(expired),
    finishedWithTurn: endings(finished, 'm2'),
    vanishedOnResync: endings(vanished),
    reconnectWhilePending: endings(reconnected),
    lateAnswerThenResync: endings(viewOf(state([SECOND], 9), late)),
  }).toMatchInlineSnapshot(`
    {
      "asked": {
        "a1": "pending",
        "a2": "pending",
      },
      "chosen": {
        "a1": "{"kind":"chosen","label":"Deny"}",
        "a2": "pending",
      },
      "expired": {
        "a1": "pending",
        "a2": "{"kind":"expired"}",
      },
      "finishedWithTurn": {
        "a1": "{"kind":"cleared"}",
        "a2": "{"kind":"cleared"}",
      },
      "lateAnswerThenResync": {
        "a1": "{"kind":"late"}",
        "a2": "pending",
      },
      "reconnectWhilePending": {
        "a1": "pending",
        "a2": "pending",
      },
      "vanishedOnResync": {
        "a1": "{"kind":"cleared"}",
        "a2": "pending",
      },
    }
  `);
});

it('keeps a watched turn’s steps on its reply when the turn ended during a resync', () => {
  const asked = apply(viewOf(state([], 1)), [
    { kind: 'generation.tool-start', toolUseId: 'u1', name: 'Read', input: { file_path: 'notes.md' } },
    { kind: 'generation.tool-end', toolUseId: 'u1', outcome: 'ok' },
    { kind: 'generation.approval-requested', approval: EDIT },
  ]);
  const after = viewOf({ ...state([], 12, null), messages: [REPLY] }, asked);
  expect({ active: after.activeTurn, finished: after.finished.m2?.steps.map((step) => (step.kind === 'tool' ? `${step.name} ${step.outcome}` : step.ending?.kind)) }).toMatchInlineSnapshot(`
    {
      "active": null,
      "finished": [
        "Read ok",
        "cleared",
      ],
    }
  `);
});

it('lets the host have the last word: its resolution replaces a local "already ended", a snapshot that still lists the request reopens it, and tools left running end as unfinished', () => {
  const asked = apply(viewOf(state([], 1)), [
    { kind: 'generation.tool-start', toolUseId: 'u1', name: 'Write', input: { file_path: '.git/config' } },
    { kind: 'generation.approval-requested', approval: EDIT },
  ]);
  const late = endApproval(asked, 'a1', { kind: 'late' });
  const resolved = apply(late, [{ kind: 'generation.approval-resolved', approvalId: 'a1', resolution: { kind: 'chosen', choiceId: 'deny' } }]);
  const stopped = apply(asked, [{ kind: 'generation.finished', message: REPLY }]);
  const endedInGap = viewOf({ ...state([], 12, null), messages: [REPLY] }, asked);
  const tools = (view: ThreadView): string[] => (view.finished.m2?.steps ?? []).flatMap((step) => (step.kind === 'tool' ? [`${step.name} ${step.outcome}`] : []));
  expect({
    resolvedAfterLate: endings(resolved),
    snapshotStillPending: endings(viewOf(state([EDIT], 9), late)),
    stoppedMidTool: tools(stopped),
    endedDuringResync: tools(endedInGap),
  }).toMatchInlineSnapshot(`
    {
      "endedDuringResync": [
        "Write unknown",
      ],
      "resolvedAfterLate": {
        "a1": "{"kind":"chosen","label":"Deny"}",
      },
      "snapshotStillPending": {
        "a1": "pending",
      },
      "stoppedMidTool": [
        "Write unfinished",
      ],
    }
  `);
});

const HELD: ('sending' | 'held')[] = ['sending', 'held'];

const card = (step: ApprovalStep, answer: 'open' | 'sending' | 'held' = 'open'): string =>
  renderToString(h(ApprovalCard, { step, answer, title: step.approval.summary, actions: { openLink: () => undefined, copy: () => undefined }, onAnswer: () => undefined }))
    .replaceAll(/<[^>]+>/g, (tag) => (tag.startsWith('<button') ? '[' : tag.startsWith('</button') ? ']' : /^<\/?code/.test(tag) ? '`' : ' '))
    .replaceAll(/\s+/g, ' ')
    .trim();

it('shows every card state, with Deny before Allow and no countdown without the host’s expiresAt', () => {
  const pending: ApprovalStep = { kind: 'approval', approval: EDIT, ending: null };
  expect({
    pending: card(pending),
    sending: card(pending, 'sending'),
    chosen: card({ ...pending, ending: { kind: 'chosen', label: 'Allow' } }),
    expired: card({ ...pending, ending: { kind: 'expired' } }),
    cleared: card({ ...pending, ending: { kind: 'cleared' } }),
    late: card({ ...pending, ending: { kind: 'late' } }),
    disabledWhileSendingOrHeld: HELD.map((answer) => renderToString(h(ApprovalCard, { step: pending, answer, title: null, actions: { openLink: () => undefined, copy: () => undefined }, onAnswer: () => undefined })).match(/<button[^>]*disabled/g)?.length),
  }).toMatchInlineSnapshot(`
    {
      "chosen": "Allow edit to \`.git/config\`? You chose Allow",
      "cleared": "Allow edit to \`.git/config\`? Request ended",
      "disabledWhileSendingOrHeld": [
        2,
        2,
      ],
      "expired": "Allow edit to \`.git/config\`? Expired: denied automatically",
      "late": "Allow edit to \`.git/config\`? This request already ended.",
      "pending": "Allow edit to \`.git/config\`? [Deny][Allow] Unanswered requests are denied after 30 minutes.",
      "sending": "Allow edit to \`.git/config\`? [Deny][Allow] Sending… Unanswered requests are denied after 30 minutes.",
    }
  `);
});
