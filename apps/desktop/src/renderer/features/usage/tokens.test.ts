import type { TokenTotals } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { groupTokens, type TokenNames } from './usage-view.ts';

const totals = (pluginId: string, agentId: string, model: string | null, turns: number, without: number, input: number | null, cached: number | null, output: number | null, reasoning: number | null): TokenTotals => ({
  pluginId,
  agentId,
  model,
  turns,
  turnsWithoutCounts: without,
  inputTokens: input,
  cachedInputTokens: cached,
  outputTokens: output,
  reasoningTokens: reasoning,
});

const ROWS: readonly TokenTotals[] = [
  totals('provider-claude', 'errand', 'opus', 3, 1, 30, 100, 12, null),
  totals('provider-claude', 'reading', 'opus', 1, 0, 5, null, 2, null),
  totals('provider-claude', 'reading', 'haiku', 2, 0, 8, 4, 3, null),
  totals('provider-antigravity', 'reading', null, 2, 1, 4, null, 1, 3),
  totals('provider-openai', 'gone', 'gpt-5', 1, 1, null, null, null, null),
];

const NAMES: TokenNames = {
  provider: (id) => ({ 'provider-claude': 'Claude', 'provider-antigravity': 'Antigravity', 'provider-openai': 'Codex' })[id] ?? id,
  agent: (id) => ({ errand: 'Errand Bot', reading: 'Reading Buddy' })[id] ?? null,
};

it('regroups the host sums by provider, model or agent, biggest first, keeping unreported sums null', () => {
  const table = (by: 'provider' | 'model' | 'agent') =>
    groupTokens(ROWS, by, NAMES).map((row) =>
      [row.label, row.detail, `turns ${String(row.turns)}`, `without ${String(row.turnsWithoutCounts)}`, `in ${String(row.inputTokens)}`, `cached ${String(row.cachedInputTokens)}`, `out ${String(row.outputTokens)}`, `reasoning ${String(row.reasoningTokens)}`]
        .filter((part) => part !== '')
        .join(' · '),
    );
  expect({ provider: table('provider'), model: table('model'), agent: table('agent') }).toMatchInlineSnapshot(`
    {
      "agent": [
        "Errand Bot · turns 3 · without 1 · in 30 · cached 100 · out 12 · reasoning null",
        "Reading Buddy · turns 5 · without 1 · in 17 · cached 4 · out 6 · reasoning 3",
        "Deleted agent · turns 1 · without 1 · in null · cached null · out null · reasoning null",
      ],
      "model": [
        "opus · Claude · turns 4 · without 1 · in 35 · cached 100 · out 14 · reasoning null",
        "haiku · Claude · turns 2 · without 0 · in 8 · cached 4 · out 3 · reasoning null",
        "Model not reported · Antigravity · turns 2 · without 1 · in 4 · cached null · out 1 · reasoning 3",
        "gpt-5 · Codex · turns 1 · without 1 · in null · cached null · out null · reasoning null",
      ],
      "provider": [
        "Claude · turns 6 · without 1 · in 43 · cached 104 · out 17 · reasoning null",
        "Antigravity · turns 2 · without 1 · in 4 · cached null · out 1 · reasoning 3",
        "Codex · turns 1 · without 1 · in null · cached null · out null · reasoning null",
      ],
    }
  `);
});
