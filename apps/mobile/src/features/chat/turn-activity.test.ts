import type { AvatarActivity } from '../../lib/bot-avatar/index.ts';
import { expect, it } from 'vitest';
import { applyEvent, viewOf, type ThreadEvent, type ThreadView } from './thread-view.ts';
import { nextActivity, turnLine } from './turn-activity.ts';

const AT = '2026-01-01T00:00:00.000Z';

const idle = (): ThreadView =>
  viewOf({
    thread: { id: 't', agentId: 'a', title: 'Main', createdAt: AT, updatedAt: AT, archivedAt: null },
    messages: [],
    reactions: [],
    toolSteps: [],
    activeTurn: null,
    blockedGroups: [],
    subagents: [],
    queue: [],
    cursor: { hostEpoch: 'e1', seq: 0 },
  });

type EventBody = ThreadEvent extends infer E ? (E extends ThreadEvent ? Omit<E, 'threadId' | 'generationId' | 'cursor'> : never) : never;

/** Each event in turn, with the chat's activity and the running turn's line after it. */
function walk(bodies: readonly EventBody[]): string[] {
  let view = idle();
  let activity: AvatarActivity | undefined;
  return bodies.map((body) => {
    const event = { ...body, threadId: 't', generationId: 'g', cursor: { hostEpoch: 'e1', seq: view.cursor.seq + 1 } };
    const applied = applyEvent(view, event);
    if (applied.kind !== 'applied') throw new Error(`${body.kind} was ${applied.kind}`);
    activity = nextActivity(activity, applied.view, view);
    view = applied.view;
    const line = view.activeTurn === null ? null : turnLine(view.activeTurn);
    return `${body.kind} → ${activity}${line === null ? '' : ` "${line.label}${line.detail === null ? '' : ` · ${line.detail}`}"`}`;
  });
}

const DONE = { kind: 'completed', finishReason: 'stop' } as const;

it('follows a chat turn through every phase to a brief completion', () => {
  expect(
    walk([
      { kind: 'generation.started', state: 'queued', userMessage: { kind: 'user', id: 'u1', threadId: 't', text: 'Plan my week', createdAt: AT, attachments: [] } },
      { kind: 'generation.status', state: 'running', queueNote: null, detail: 'Thinking' },
      { kind: 'generation.tool-start', toolUseId: 'x1', name: 'calendar', input: {} },
      { kind: 'generation.status', state: 'running', queueNote: null, detail: 'Reading your calendar' },
      { kind: 'generation.approval-requested', approval: { approvalId: 'a1', summary: 'Add an event?', choices: [{ id: 'allow', label: 'Allow' }] } },
      { kind: 'generation.approval-resolved', approvalId: 'a1', resolution: { kind: 'chosen', choiceId: 'allow' } },
      { kind: 'generation.tool-end', toolUseId: 'x1', outcome: 'ok' },
      { kind: 'generation.delta', text: 'Done: ' },
      { kind: 'generation.finished', message: { kind: 'assistant', attachments: [], id: 'r1', threadId: 't', text: 'Done: added.', createdAt: AT, outcome: DONE } },
      { kind: 'queue.changed', queue: [] },
    ]),
  ).toMatchInlineSnapshot(`
    [
      "generation.started → queued "Queued · Waiting for a free slot"",
      "generation.status → thinking "Thinking"",
      "generation.tool-start → running-tool "Using a tool"",
      "generation.status → running-tool "Using a tool · Reading your calendar"",
      "generation.approval-requested → needs-approval "Waiting for your approval · Reading your calendar"",
      "generation.approval-resolved → running-tool "Using a tool · Reading your calendar"",
      "generation.tool-end → thinking "Thinking · Reading your calendar"",
      "generation.delta → streaming "Writing · Reading your calendar"",
      "generation.finished → completed",
      "queue.changed → completed",
    ]
  `);
});

it('goes straight back to idle when a background turn ends without a reply', () => {
  expect(
    walk([
      { kind: 'generation.background-started', agentMessageId: 'am1', state: 'running' },
      { kind: 'generation.background-finished', outcome: DONE },
    ]),
  ).toMatchInlineSnapshot(`
    [
      "generation.background-started → thinking "Thinking"",
      "generation.background-finished → idle",
    ]
  `);
});
