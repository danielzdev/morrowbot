import type { AssistantMessage, ThreadState, UserMessage } from '@morrowbot/contracts';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { afterEach, expect, it, vi } from 'vitest';
import { nextActivity, type ChatActivity } from './activity.ts';
import { chatDisplay } from './display.ts';
import { applyEvent, viewOf, type ThreadEvent, type ThreadView } from './thread-model.ts';
import { Timeline, type TimelineContext } from './Timeline.tsx';
import { extraDetail, phaseOf } from './turn-phase.ts';

const AT = '2026-01-01T00:00:00.000Z';
const IDLE: ThreadState = {
  thread: { id: 't', agentId: 'a', title: 'Chat', createdAt: AT, updatedAt: AT },
  messages: [],
  activeTurn: null,
  queue: [],
  blockedGroups: [],
  subagents: [],
  reactions: [],
  toolSteps: [],
  cursor: { hostEpoch: 'e', seq: 0 },
};
const DISPLAY = { path: (path: string) => path, redact: (text: string) => text };
afterEach(() => {
  vi.useRealTimers();
});

const turn = (seq: number) => ({ threadId: 't', generationId: 'g', cursor: { hostEpoch: 'e', seq } });

it('names each phase of a turn beside the avatar, from queued through a tool, an approval and the reply to the celebration', () => {
  const events: ThreadEvent[] = [
    { kind: 'generation.started', ...turn(1), state: 'queued', userMessage: { kind: 'user', id: 'u', threadId: 't', text: 'Find it', createdAt: AT, attachments: [] } },
    { kind: 'generation.status', ...turn(2), state: 'running', queueNote: null, detail: 'Thinking…' },
    { kind: 'generation.tool-start', ...turn(3), toolUseId: 'w', name: 'WebSearch', input: { query: 'tide tables' } },
    { kind: 'generation.tool-start', ...turn(4), toolUseId: 'r', name: 'Read', input: { file_path: 'notes.md' } },
    { kind: 'generation.tool-end', ...turn(5), toolUseId: 'r', outcome: 'ok' },
    { kind: 'generation.tool-end', ...turn(6), toolUseId: 'w', outcome: 'ok' },
    { kind: 'generation.status', ...turn(7), state: 'running', queueNote: null, detail: 'Planning the answer' },
    { kind: 'generation.approval-requested', ...turn(8), approval: { approvalId: 'p', summary: 'Write notes.md', choices: [{ id: 'allow', label: 'Allow' }] } },
    { kind: 'generation.approval-resolved', ...turn(9), approvalId: 'p', resolution: { kind: 'chosen', choiceId: 'allow' } },
    { kind: 'generation.delta', ...turn(10), text: 'High tide is at 6.' },
    { kind: 'generation.tool-start', ...turn(11), toolUseId: 'b', name: 'Bash', input: { command: 'date' } },
    { kind: 'generation.tool-end', ...turn(12), toolUseId: 'b', outcome: 'ok' },
    { kind: 'generation.finished', ...turn(13), message: { kind: 'assistant', id: 'm', threadId: 't', text: 'High tide is at 6.', outcome: { kind: 'completed', finishReason: 'stop' }, createdAt: AT } },
  ];
  let view = viewOf(IDLE);
  let activity: ChatActivity = 'idle';
  const seen = events.map((event) => {
    const applied = applyEvent(view, event, 0);
    if (applied.kind !== 'applied') throw new Error(`${event.kind}: ${applied.kind}`);
    activity = nextActivity(activity, applied.view, view);
    view = applied.view;
    const active = view.activeTurn;
    if (active === null) return `${event.kind} → ${activity}`;
    const { phase, label } = phaseOf(active, DISPLAY);
    const detail = extraDetail(active.detail, label);
    return `${event.kind} → ${phase} "${label}"${detail === null ? '' : ` · ${detail}`}${phase === activity ? '' : ` (chat: ${activity})`}`;
  });
  expect(seen).toMatchInlineSnapshot(`
    [
      "generation.started → queued "Queued"",
      "generation.status → thinking "Thinking"",
      "generation.tool-start → running-tool "Searching"",
      "generation.tool-start → running-tool "Reading"",
      "generation.tool-end → running-tool "Searching"",
      "generation.tool-end → thinking "Thinking"",
      "generation.status → thinking "Thinking" · Planning the answer",
      "generation.approval-requested → needs-approval "Waiting for your approval" · Planning the answer",
      "generation.approval-resolved → thinking "Thinking" · Planning the answer",
      "generation.delta → streaming "Writing" · Planning the answer",
      "generation.tool-start → running-tool "Running a command" · Planning the answer",
      "generation.tool-end → streaming "Writing" · Planning the answer",
      "generation.finished → completed",
    ]
  `);
});

const CTX: TimelineContext = {
  display: chatDisplay(null, null),
  copy: { provider: null, safe: (text) => text },
  actions: { openLink: () => undefined, copy: () => undefined },
  onAction: () => undefined,
  onAnswer: () => undefined,
  onReact: () => undefined,
  agentName: 'Friday',
  image: () => Promise.resolve(null),
  peers: { name: () => 'Peer', color: () => '#6b7280', avatar: () => null },
  engine: ({ pluginId }) => pluginId,
  avatar: (activity) => h('i', { 'data-avatar': activity }),
};

/** Each turn row as "[the avatar's activity] its text". */
function rows(view: ThreadView, activity: ChatActivity): string[] {
  const html = renderToString(h(Timeline, { view, start: 0, answering: [], idle: view.activeTurn === null, locked: false, offline: false, ctx: CTX, onShowEarlier: () => undefined, activity }));
  return [...html.matchAll(/<div class="turn-time[^"]*">(.*?)<\/div>/g)].map(([, row = '']) =>
    row.replace(/<i data-avatar="([^"]+)"><\/i>/g, '[$1] ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
  );
}

const USER: UserMessage = { kind: 'user', id: 'u', threadId: 't', text: 'Find it', createdAt: AT, attachments: [] };
const REPLY: AssistantMessage = { kind: 'assistant', id: 'm', threadId: 't', text: 'High tide is at 6.', outcome: { kind: 'completed', finishReason: 'stop' }, createdAt: AT };

function play(view: ThreadView, events: readonly ThreadEvent[], now = 0): ThreadView {
  return events.reduce((before, event) => {
    const applied = applyEvent(before, event, now);
    if (applied.kind !== 'applied') throw new Error(`${event.kind}: ${applied.kind}`);
    return applied.view;
  }, view);
}

it('puts the avatar beside the running turn, then beside the reply it wrote: celebrating while the chat is completed, resting after', () => {
  vi.useFakeTimers({ now: 5_000 });
  const running = play(viewOf(IDLE), [
    { kind: 'generation.started', ...turn(1), state: 'running', userMessage: USER },
    { kind: 'generation.tool-start', ...turn(2), toolUseId: 'w', name: 'WebSearch', input: { query: 'tide tables' } },
  ]);
  const finished = play(running, [{ kind: 'generation.finished', ...turn(3), message: REPLY }], 12_000);
  const openedMidTurn = play(viewOf({ ...IDLE, messages: [USER], activeTurn: { generationId: 'g', trigger: { kind: 'chat' }, state: 'running', queueNote: null, text: 'High', pendingApprovals: [], toolSteps: [] } }), [
    { kind: 'generation.finished', ...turn(1), message: REPLY },
  ]);
  expect({
    running: rows(running, 'running-tool'),
    completed: rows(finished, 'completed'),
    settled: rows(finished, 'idle'),
    openedMidTurnCompleted: rows(openedMidTurn, 'completed'),
    fromHistory: rows(viewOf({ ...IDLE, messages: [...finished.messages] }), 'idle'),
  }).toMatchInlineSnapshot(`
    {
      "completed": [
        "[completed] Worked for 12s",
      ],
      "fromHistory": [],
      "openedMidTurnCompleted": [
        "[completed] Done",
      ],
      "running": [
        "[running-tool] Searching · 5s",
      ],
      "settled": [
        "[idle] Worked for 12s",
      ],
    }
  `);
});
