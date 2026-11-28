import type { Message, SubagentRun, SubagentStatus, ThreadState } from '@morrowbot/contracts';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { SubagentGroup } from './SubagentGroup.tsx';
import { applyEvent, viewOf, type ThreadEvent } from './thread-model.ts';
import { timelineItems } from './timeline-items.ts';

const at = (second: number): string => new Date(Date.UTC(2026, 0, 1, 9, 0, second)).toISOString();

function subagent(id: string, second: number, status: SubagentStatus, pluginId = 'claude'): SubagentRun {
  return {
    id,
    parentThreadId: 't',
    parentGenerationId: 'g',
    role: id,
    binding: { kind: 'bound', pluginId, selection: { kind: 'default' }, access: 'read-only', vendorSettings: 'isolated' },
    prompt: `Review ${id}`,
    status,
    createdAt: at(second),
  };
}

const DONE: SubagentStatus = { kind: 'finished', outcome: { kind: 'completed', finishReason: 'stop' }, reply: 'Looks good', finishedAt: at(9) };

const STATE: ThreadState = {
  thread: { id: 't', agentId: 'a', title: 'Chat', createdAt: at(0), updatedAt: at(0) },
  messages: [],
  activeTurn: null,
  queue: [],
  blockedGroups: [],
  subagents: [],
  cursor: { hostEpoch: 'e', seq: 0 },
};

it('keeps each sub-agent’s latest status from subagent.changed, even after its parent turn ended', () => {
  let view = viewOf(STATE);
  const changed = (seq: number, run: SubagentRun): ThreadEvent => ({ kind: 'subagent.changed', threadId: 't', generationId: 'g', cursor: { hostEpoch: 'e', seq }, run });
  const steps = [
    changed(1, subagent('Reviewer', 1, { kind: 'queued', queueNote: null })),
    changed(2, subagent('Tester', 2, { kind: 'running' })),
    changed(3, subagent('Reviewer', 1, { kind: 'running' })),
    changed(4, subagent('Reviewer', 1, DONE)),
  ].map((event) => {
    const applied = applyEvent(view, event, 0);
    if (applied.kind === 'applied') view = applied.view;
    return applied.kind;
  });
  expect({ steps, runs: view.subagents.map(({ id, status }) => `${id}: ${status.kind}`) }).toMatchInlineSnapshot(`
    {
      "runs": [
        "Reviewer: finished",
        "Tester: running",
      ],
      "steps": [
        "applied",
        "applied",
        "applied",
        "applied",
      ],
    }
  `);
});

it('shows sub-agents between the message that started them and the reply, apart from agent messages', () => {
  const user: Message = { kind: 'user', id: 'ask', threadId: 't', text: 'Review this', createdAt: at(0), attachments: [] };
  const reply: Message = { kind: 'assistant', id: 'reply', threadId: 't', text: 'Done', outcome: { kind: 'completed', finishReason: 'stop' }, createdAt: at(10) };
  const items = timelineItems([user, reply], [], [subagent('a', 1, DONE), subagent('b', 2, DONE), subagent('late', 11, { kind: 'running' })], 0);
  expect(items.map((item) => (item.kind === 'subagents' ? item.runs.map(({ id }) => id) : item.kind === 'message' ? item.message.id : item.kind))).toMatchInlineSnapshot(`
    [
      "ask",
      [
        "a",
        "b",
      ],
      "reply",
      [
        "late",
      ],
    ]
  `);
});

/** The visible text of a collapsed group, with its pulse marked. */
const pill = (runs: readonly SubagentRun[]): string =>
  renderToString(h(SubagentGroup, { runs, engine: ({ pluginId }) => (pluginId === 'codex' ? 'Codex · GPT-5.5 · High' : 'Claude'), actions: { openLink: () => undefined, copy: () => undefined } }))
    .replaceAll(/<span [^>]*class="pulse"[^>]*><\/span>/g, '(pulse) ')
    .replaceAll(/<svg.*?<\/svg>/g, '')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();

it('sums up one sub-agent by its role, provider and status, and several by how many are in each state', () => {
  expect({
    working: pill([subagent('Reviewer', 1, { kind: 'running' }, 'codex')]),
    done: pill([subagent('Reviewer', 1, DONE)]),
    stopped: pill([subagent('Reviewer', 1, { ...DONE, outcome: { kind: 'cancelled' } })]),
    several: pill([subagent('a', 1, DONE), subagent('b', 2, { kind: 'running' }, 'codex'), subagent('c', 3, { kind: 'queued', queueNote: null })]),
  }).toMatchInlineSnapshot(`
    {
      "done": "Sub-agent Reviewer Claude Done",
      "several": "(pulse) 3 sub-agents 1 done · 1 working · 1 queued",
      "stopped": "Sub-agent Reviewer Claude Stopped",
      "working": "(pulse) Sub-agent Reviewer Codex · GPT-5.5 · High Working",
    }
  `);
});
