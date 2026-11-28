import type { AssistantMessage, ThreadState, TurnOutcome, UserMessage } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { problemText, viewAnnouncement } from './live-region.ts';
import { applyEvent, viewOf, type ThreadEvent, type ThreadView } from './thread-model.ts';
import type { PendingAction } from './thread-session.ts';

const AT = '2026-01-01T00:00:00.000Z';
const BASE: ThreadState = {
  thread: { id: 't', agentId: 'a', title: 'Chat', createdAt: AT, updatedAt: AT },
  messages: [],
  reactions: [],
  activeTurn: null,
  queue: [],
  blockedGroups: [],
  cursor: { hostEpoch: 'e1', seq: 0 },
};
const COPY = { provider: 'Claude', safe: (text: string) => text };
const reply = (id: string, outcome: TurnOutcome, text = 'Here is the plan.'): AssistantMessage => ({ kind: 'assistant', id, threadId: 't', text, createdAt: AT, outcome });
const user: UserMessage = { kind: 'user', id: 'u1', threadId: 't', text: 'Plan my week', createdAt: AT, attachments: [] };

/** Each event's announcement in "Status only" and "Status and replies". */
function announce(events: readonly ThreadEvent[]): string[] {
  let view: ThreadView = viewOf(BASE);
  const said: string[] = [];
  for (const event of events) {
    const applied = applyEvent(view, event, 0);
    if (applied.kind !== 'applied') throw new Error(applied.kind);
    const status = viewAnnouncement(view, applied.view, 'Errand Bot', COPY, 'status');
    const replies = viewAnnouncement(view, applied.view, 'Errand Bot', COPY, 'replies');
    said.push(`${event.kind}: ${status ?? '—'}${replies === status ? '' : ` | ${replies ?? '—'}`}`);
    view = applied.view;
  }
  return said;
}

let seq = 0;
const at = (generationId = 'g1') => ({ threadId: 't', generationId, cursor: { hostEpoch: 'e1', seq: ++seq } });

it('announces a turn starting, an approval, a finished reply and an error, but never streamed text', () => {
  seq = 0;
  const said = announce([
    { kind: 'generation.started', ...at(), userMessage: user, state: 'running' },
    { kind: 'generation.delta', ...at(), text: 'Here is ' },
    { kind: 'generation.tool-start', ...at(), toolUseId: 'x', name: 'Read', input: {} },
    { kind: 'generation.approval-requested', ...at(), approval: { approvalId: 'p', summary: 'Allow?', choices: [{ id: 'allow', label: 'Allow' }] } },
    { kind: 'generation.approval-resolved', ...at(), approvalId: 'p', resolution: { kind: 'chosen', choiceId: 'allow' } },
    { kind: 'generation.delta', ...at(), text: 'the plan.' },
    { kind: 'generation.finished', ...at(), message: reply('m1', { kind: 'completed', finishReason: 'stop' }) },
    { kind: 'generation.started', ...at('g2'), userMessage: null, state: 'queued' },
    { kind: 'generation.status', ...at('g2'), state: 'running', queueNote: null, detail: 'Thinking' },
    { kind: 'generation.finished', ...at('g2'), message: reply('m2', { kind: 'failed', error: { kind: 'signed-out' } }, '') },
  ]);
  expect({ said, firstLoad: viewAnnouncement(null, viewOf(BASE), 'Errand Bot', COPY, 'status') }).toMatchInlineSnapshot(`
    {
      "firstLoad": null,
      "said": [
        "generation.started: Errand Bot is working.",
        "generation.delta: —",
        "generation.tool-start: —",
        "generation.approval-requested: Errand Bot needs approval.",
        "generation.approval-resolved: —",
        "generation.delta: —",
        "generation.finished: Errand Bot replied. | Errand Bot replied: Here is the plan.",
        "generation.started: Errand Bot is queued.",
        "generation.status: —",
        "generation.finished: Errand Bot's reply failed. Claude is signed out.",
      ],
    }
  `);
});

it('announces why a send was refused', () => {
  const action: PendingAction = { kind: 'send', text: 'hi', attachmentIds: [] };
  expect([
    problemText({ kind: 'retry', reason: 'rechecking', action, sessionChoice: { kind: 'auto' } }, () => null),
    problemText({ kind: 'session-choice', reason: 'diverged', action }, () => null),
    problemText({ kind: 'error', message: 'Write failed in /Users/sam' }, (text) => text.replace('/Users/sam', '~')),
    problemText({ kind: 'error', message: 'Write failed in /Users/sam' }, () => null),
  ]).toMatchInlineSnapshot(`
    [
      "Rechecking the provider… your message is kept.",
      "The provider's saved session did not finish its last turn.",
      "Write failed in ~",
      "The provider couldn't take this message.",
    ]
  `);
});
