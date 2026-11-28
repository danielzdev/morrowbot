import { Connector, type ConnectorStatus } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { attentionGroups, connectorNote, scopeChip, usedBy } from './connector-copy.ts';

const AGENTS = [
  { id: 'errand', name: 'Errand Bot' },
  { id: 'money', name: 'Money Buddy' },
  { id: 'reading', name: 'Reading Buddy' },
];

it('words a saved scope as a chip and as who a Disconnect or Remove affects', () => {
  const scopes = [
    { mode: 'all', agentIds: [] },
    { mode: 'selected', agentIds: [] },
    { mode: 'selected', agentIds: ['money'] },
    { mode: 'selected', agentIds: ['money', 'errand'] },
    { mode: 'selected', agentIds: ['reading', 'money', 'errand'] },
  ] as const;
  const all: { mode: 'all'; agentIds: string[] } = { mode: 'all', agentIds: [] };
  expect([usedBy(all, AGENTS.slice(0, 2)), usedBy(all, AGENTS.slice(0, 1)), usedBy(all, [])]).toMatchInlineSnapshot(`
    [
      "All agents use this: Errand Bot and Money Buddy.",
      "All agents use this: Errand Bot.",
      "All agents get this; there are none yet.",
    ]
  `);
  expect(scopes.map((scope) => `${scopeChip({ ...scope, agentIds: [...scope.agentIds] })} | ${usedBy({ ...scope, agentIds: [...scope.agentIds] }, AGENTS)}`)).toMatchInlineSnapshot(`
    [
      "All agents | All agents use this: Errand Bot, 2 other agents.",
      "No agents | No agents use this.",
      "1 agent | Money Buddy uses this.",
      "2 agents | Errand Bot and Money Buddy use this.",
      "3 agents | Errand Bot, 2 other agents use this.",
    ]
  `);
});

const AT = '2026-01-01T00:00:00.000Z';
const connector = (id: string, status: ConnectorStatus): Connector =>
  Connector.parse({
    id,
    label: id,
    labelKey: id,
    setup: { kind: 'http', url: 'https://example.com/mcp', headers: [] },
    enabled: true,
    connected: true,
    scope: { mode: 'all', agentIds: [], revision: 1, scopeReviewRequired: false },
    status,
    tools: [],
    createdAt: AT,
    updatedAt: AT,
  });

it('puts connectors that need the user first, and words them for the Extensions row', () => {
  const fine = connector('calendar', { kind: 'connected', toolCount: 2 });
  const off = connector('notes', { kind: 'turned_off' });
  const signIn = connector('mail', { kind: 'reconnect_needed', message: 'Sign in again' });
  const crashed = connector('files', { kind: 'crashed', message: 'exit 1' });
  const titled = (list: readonly Connector[]) => attentionGroups(list).map(({ title, connectors }) => `${title ?? '(none)'}: ${connectors.map(({ id }) => id).join(', ')}`);
  expect({
    groups: titled([fine, signIn, off, crashed]),
    allFine: titled([fine, off]),
    allTroubled: titled([signIn]),
    notes: [connectorNote([fine, off]), connectorNote([fine, signIn]), connectorNote([signIn, crashed])],
  }).toMatchInlineSnapshot(`
    {
      "allFine": [
        "(none): calendar, notes",
      ],
      "allTroubled": [
        "Needs attention: mail",
      ],
      "groups": [
        "Needs attention: mail, files",
        "All: calendar, notes",
      ],
      "notes": [
        null,
        {
          "text": "1 connector needs attention",
          "tone": "warn",
        },
        {
          "text": "2 connectors need attention",
          "tone": "danger",
        },
      ],
    }
  `);
});
