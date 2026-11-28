import type { Message, ThreadState } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { applyEvent, viewOf, type ThreadView, type TurnStep } from './thread-model.ts';

const AT = '2026-01-01T00:00:00.000Z';
const READ = { toolUseId: 'read-1', name: 'Read', input: { file_path: 'notes.md' }, startedAt: '2026-01-01T00:00:01.000Z' };
const BASH = { toolUseId: 'bash-1', name: 'Bash', input: { command: 'make test' }, startedAt: '2026-01-01T00:00:03.000Z' };
const REPLY: Message = { kind: 'assistant', attachments: [], id: 'a1', threadId: 't', text: 'Done', outcome: { kind: 'completed', finishReason: 'stop' }, createdAt: AT };

const state = (patch: Partial<ThreadState>): ThreadState => ({
  thread: { id: 't', agentId: 'a', title: 'Chat', createdAt: AT, updatedAt: AT, archivedAt: null },
  messages: [],
  reactions: [],
  toolSteps: [],
  activeTurn: null,
  queue: [],
  blockedGroups: [],
  subagents: [],
  cursor: { hostEpoch: 'e1', seq: 1 },
  ...patch,
});

const running = (toolSteps: ThreadState['toolSteps'][number]['steps']): ThreadState['activeTurn'] => ({
  generationId: 'g',
  trigger: { kind: 'chat' },
  state: 'running',
  queueNote: null,
  text: '',
  pendingApprovals: [],
  toolSteps,
});

const lines = (steps: readonly TurnStep[] | undefined): string[] =>
  (steps ?? []).map((step) =>
    step.kind === 'tool' ? `${step.name}: ${step.outcome}${step.endedAt === null ? '' : ` in ${String(step.endedAt - step.startedAt)} ms`}` : 'approval',
  );

it('a reload mid-turn takes the result of a tool whose end event it missed, and adds the calls it never saw', () => {
  let view: ThreadView = viewOf(state({ activeTurn: running([]) }));
  const started = applyEvent(view, { kind: 'generation.tool-start', threadId: 't', generationId: 'g', cursor: { hostEpoch: 'e1', seq: 2 }, toolUseId: 'read-1', name: 'Read', input: READ.input }, 10_000);
  if (started.kind !== 'applied') throw new Error(started.kind);
  view = started.view;
  const reloaded = viewOf(
    state({ activeTurn: running([{ ...READ, outcome: 'ok', endedAt: '2026-01-01T00:00:02.500Z' }, { ...BASH, outcome: 'running' }]), cursor: { hostEpoch: 'e1', seq: 5 } }),
    view,
  );
  const finished = applyEvent(reloaded, { kind: 'generation.finished', threadId: 't', generationId: 'g', cursor: { hostEpoch: 'e1', seq: 6 }, message: REPLY }, 20_000);
  expect({
    beforeReload: lines(view.activeTurn?.steps),
    afterReload: lines(reloaded.activeTurn?.steps),
    onReply: finished.kind === 'applied' ? lines(finished.view.finished.a1?.steps) : finished.kind,
  }).toMatchInlineSnapshot(`
    {
      "afterReload": [
        "Read: ok in 1500 ms",
        "Bash: running",
      ],
      "beforeReload": [
        "Read: running",
      ],
      "onReply": [
        "Read: ok in 1500 ms",
        "Bash: unfinished",
      ],
    }
  `);
});

it("a thread opened from history shows each reply's saved tool calls; a reply that called none shows no steps", () => {
  const user: Message = { kind: 'user', id: 'u1', threadId: 't', text: 'Run the tests', createdAt: AT, attachments: [] };
  const quiet: Message = { ...REPLY, id: 'a0', text: 'Hi' };
  const view = viewOf(
    state({
      messages: [quiet, user, REPLY],
      toolSteps: [{ messageId: 'a1', steps: [{ ...READ, outcome: 'ok', endedAt: '2026-01-01T00:00:02.000Z' }, { ...BASH, outcome: 'unfinished' }] }],
    }),
  );
  expect(Object.fromEntries(Object.entries(view.finished).map(([id, record]) => [id, { steps: lines(record.steps), durationMs: record.durationMs }]))).toMatchInlineSnapshot(`
    {
      "a1": {
        "durationMs": null,
        "steps": [
          "Read: ok in 1000 ms",
          "Bash: unfinished",
        ],
      },
    }
  `);
});
