import type { Agent } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { groupAgents, type AgentFacts } from './sidebar-groups.ts';

const BOUND: Agent['provider'] = { kind: 'bound', pluginId: 'provider-echo', selection: { kind: 'default' }, access: 'read-only', vendorSettings: 'isolated' };

function facts(name: string, change: Partial<AgentFacts> = {}, description = ''): AgentFacts {
  const agent: Agent = {
    id: `agent-${name.toLowerCase().replaceAll(' ', '-')}`,
    name,
    description,
    workspace: { kind: 'dedicated', dir: '/data/workspaces/x' },
    avatar: { kind: 'bot', shape: 'chat', color: '#6b7280', finish: 'flat' },
    provider: BOUND,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  return { agent, providerReady: true, approvalChats: [], failed: false, working: null, unread: false, lastActive: null, ...change };
}

const shown = (groups: ReturnType<typeof groupAgents>) =>
  groups.flatMap((group) => [`# ${group.id}`, ...group.entries.map(({ agent, status }) => `${agent.name}: ${JSON.stringify(status)}`)]);

it('puts each agent in one group by priority, alphabetical inside, and hides empty groups', () => {
  const all = [
    facts('Reading Buddy', { approvalChats: ['t1'], working: 'running' }),
    facts('errand Bot', { working: 'running' }),
    facts('Zed Helper', { agent: { ...facts('Zed Helper').agent, provider: { kind: 'unbound' } } }),
    facts('Inbox Helper', { lastActive: '2026-01-02T00:00:00.000Z' }),
    facts('Garden Pal', { providerReady: false, working: 'running' }),
    facts('Alarm Clock', { working: 'queued' }),
    facts('Notes', { failed: true }),
    facts('Mail Sorter', { unread: true }),
    facts('Unopened', { providerReady: null }),
  ];
  expect(shown(groupAgents(all, ''))).toMatchInlineSnapshot(`
    [
      "# needs-you",
      "Garden Pal: {"kind":"needs-you","reason":"provider"}",
      "Notes: {"kind":"needs-you","reason":"failed"}",
      "Reading Buddy: {"kind":"needs-approval","threadIds":["t1"]}",
      "Zed Helper: {"kind":"needs-you","reason":"unbound"}",
      "# working",
      "Alarm Clock: {"kind":"queued"}",
      "errand Bot: {"kind":"working"}",
      "# agents",
      "Inbox Helper: {"kind":"known","lastActive":"2026-01-02T00:00:00.000Z"}",
      "Mail Sorter: {"kind":"unread"}",
      "Unopened: {"kind":"unknown"}",
    ]
  `);
});

it('filters by name and description, ignoring case', () => {
  const all = [facts('Errand Bot', {}, 'Groceries and pharmacy runs'), facts('Reading Buddy', {}, 'Book notes'), facts('Inbox Helper')];
  expect({
    byName: shown(groupAgents(all, 'BUDDY')),
    byDescription: shown(groupAgents(all, 'grocer')),
    none: groupAgents(all, 'zzz'),
  }).toMatchInlineSnapshot(`
    {
      "byDescription": [
        "# agents",
        "Errand Bot: {"kind":"unknown"}",
      ],
      "byName": [
        "# agents",
        "Reading Buddy: {"kind":"unknown"}",
      ],
      "none": [],
    }
  `);
});
