import type { Agent } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { groupAgents, type AgentFacts } from './sidebar-groups.ts';
import { itemsOf, windowOf } from './sidebar-window.ts';

function many(count: number): readonly AgentFacts[] {
  return Array.from({ length: count }, (_, index) => {
    const agent: Agent = {
      id: `agent-${String(index).padStart(3, '0')}`,
      name: `Helper ${String(index).padStart(3, '0')}`,
      description: '',
      workspace: { kind: 'dedicated', dir: '/data/workspaces/x' },
      avatar: { kind: 'bot', shape: 'chat', color: '#6b7280', finish: 'flat' },
      provider: { kind: 'unbound' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    return { agent, providerReady: null, approvalChats: [], failed: false, working: index % 50 === 7 ? 'running' : null, unread: false, lastActive: null };
  });
}

const summary = (items: ReturnType<typeof itemsOf>, scrollTop: number, viewport: number, agents: number) => {
  const shown = windowOf(items, scrollTop, viewport, agents);
  const rows = items.slice(shown.start, shown.end);
  const total = shown.before + shown.after + rows.reduce((sum, item) => sum + (item.kind === 'header' ? 28 : 36), 0);
  return { rendered: rows.length, first: rows[0]?.key, last: rows.at(-1)?.key, before: shown.before, total };
};

it('renders every row up to 60 agents, and only the rows in view (plus a margin) above that', () => {
  const small = itemsOf(groupAgents(many(60), ''), false);
  const large = itemsOf(groupAgents(many(200), ''), false);
  expect({
    small: summary(small, 0, 600, 60),
    top: summary(large, 0, 600, 200),
    middle: summary(large, 3000, 600, 200),
    bottom: summary(large, 200 * 36 + 56 - 600, 600, 200),
    rail: itemsOf(groupAgents(many(3), ''), true).map((item) => item.kind),
  }).toMatchInlineSnapshot(`
    {
      "bottom": {
        "before": 6436,
        "first": "agent-178",
        "last": "agent-199",
        "rendered": 22,
        "total": 7228,
      },
      "middle": {
        "before": 2764,
        "first": "agent-076",
        "last": "agent-105",
        "rendered": 30,
        "total": 7228,
      },
      "rail": [
        "agent",
        "agent",
        "agent",
      ],
      "small": {
        "before": 0,
        "first": "header-needs-you",
        "last": "agent-059",
        "rendered": 61,
        "total": 2188,
      },
      "top": {
        "before": 0,
        "first": "header-needs-you",
        "last": "agent-021",
        "rendered": 23,
        "total": 7228,
      },
    }
  `);
});
