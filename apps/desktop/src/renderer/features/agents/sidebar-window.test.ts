import type { Agent, Folder } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { groupAgents, type AgentFacts } from './sidebar-groups.ts';
import { EMPTY_PX, HEADER_PX, itemsOf, ROW_PX, windowOf } from './sidebar-window.ts';

const LATER: Folder = { id: 'f-later', name: 'Later', createdAt: '2026-01-01T00:00:00.000Z' };
const EMPTY: Folder = { id: 'f-empty', name: 'Empty', createdAt: '2026-01-01T00:00:00.000Z' };

function many(count: number): readonly AgentFacts[] {
  return Array.from({ length: count }, (_, index) => {
    const agent: Agent = {
      id: `agent-${String(index).padStart(3, '0')}`,
      name: `Helper ${String(index).padStart(3, '0')}`,
      description: '',
      workspace: { kind: 'dedicated', dir: '/data/workspaces/x' },
      avatar: { kind: 'bot', shape: 'chat', color: '#6b7280', finish: 'flat' },
      provider: { kind: 'bound', pluginId: 'provider-echo', selection: { kind: 'default' }, access: 'read-only', vendorSettings: 'isolated' },
      folderId: index >= 150 ? LATER.id : null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    return { agent, providerReady: true, approvalChats: [], failed: false, working: index % 50 === 7 ? 'running' : null, unread: false, lastMessage: null };
  });
}

const NONE: ReadonlySet<string> = new Set();
const heightOf = (kind: string): number => (kind === 'header' ? HEADER_PX : kind === 'empty' ? EMPTY_PX : ROW_PX);

const summary = (items: ReturnType<typeof itemsOf>, scrollTop: number, viewport: number, agents: number) => {
  const shown = windowOf(items, scrollTop, viewport, agents, false);
  const rows = items.slice(shown.start, shown.end);
  const total = shown.before + shown.after + rows.reduce((sum, item) => sum + heightOf(item.kind), 0);
  return { rendered: rows.length, first: rows[0]?.key, last: rows.at(-1)?.key, before: shown.before, total };
};

it('renders every row up to 60 agents, and only the rows in view (plus a margin) above that', () => {
  const small = itemsOf(groupAgents(many(60), [], ''), false, NONE);
  const large = itemsOf(groupAgents(many(200), [LATER], ''), false, NONE);
  expect({
    small: summary(small, 0, 600, 60),
    top: summary(large, 0, 600, 200),
    middle: summary(large, 6000, 600, 200),
    bottom: summary(large, 12_908 - 600, 600, 200),
  }).toMatchInlineSnapshot(`
    {
      "bottom": {
        "before": 11884,
        "first": "agent-184",
        "last": "agent-199",
        "rendered": 16,
        "total": 12908,
      },
      "middle": {
        "before": 5576,
        "first": "agent-084",
        "last": "agent-105",
        "rendered": 22,
        "total": 12908,
      },
      "small": {
        "before": 0,
        "first": "header-working",
        "last": "agent-059",
        "rendered": 62,
        "total": 3912,
      },
      "top": {
        "before": 0,
        "first": "header-working",
        "last": "agent-011",
        "rendered": 17,
        "total": 12908,
      },
    }
  `);
});

it('folds Agents and folders but not status sections, notes an empty folder, and shows every agent in the rail', () => {
  const groups = groupAgents(many(160), [LATER, EMPTY], '');
  const kinds = (items: ReturnType<typeof itemsOf>) => items.filter((item) => item.kind !== 'agent').map((item) => (item.kind === 'header' ? `${item.key} (${String(item.count)}${item.collapsed ? ', folded' : ''})` : item.key));
  expect({
    open: kinds(itemsOf(groups, false, NONE)),
    folded: kinds(itemsOf(groups, false, new Set(['working', 'agents', 'folder-f-later']))),
    foldedAgentRows: itemsOf(groups, false, new Set(['agents', 'folder-f-later'])).filter((item) => item.kind === 'agent').length,
    railAgentRows: itemsOf(groups, true, new Set(['agents', 'folder-f-later'])).filter((item) => item.kind === 'agent').length,
  }).toMatchInlineSnapshot(`
    {
      "folded": [
        "header-working (4)",
        "header-agents (147, folded)",
        "header-folder-f-later (9, folded)",
        "header-folder-f-empty (0)",
        "empty-folder-f-empty",
      ],
      "foldedAgentRows": 4,
      "open": [
        "header-working (4)",
        "header-agents (147)",
        "header-folder-f-later (9)",
        "header-folder-f-empty (0)",
        "empty-folder-f-empty",
      ],
      "railAgentRows": 160,
    }
  `);
});
