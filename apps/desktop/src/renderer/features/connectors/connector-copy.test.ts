import { expect, it } from 'vitest';
import { scopeChip, usedBy } from './connector-copy.ts';

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
  expect(scopes.map((scope) => `${scopeChip({ ...scope, agentIds: [...scope.agentIds] })} | ${usedBy({ ...scope, agentIds: [...scope.agentIds] }, AGENTS)}`)).toMatchInlineSnapshot(`
    [
      "All agents | All agents use this.",
      "No agents | No agents use this.",
      "1 agent | Money Buddy uses this.",
      "2 agents | Errand Bot and Money Buddy use this.",
      "3 agents | Errand Bot, 2 other agents use this.",
    ]
  `);
});
