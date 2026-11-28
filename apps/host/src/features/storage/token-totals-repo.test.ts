import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TurnUsage } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openStorage, type Storage } from './index.ts';

const NOW = '2026-03-31T12:00:00.000Z';

let dir: string;
let storage: Storage;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'orikami-tokens-'));
  storage = openStorage(path.join(dir, 'orikami.sqlite'), () => NOW);
});
afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

const reported = (inputTokens: number, outputTokens: number, more: { cached?: number; reasoning?: number } = {}): TurnUsage => ({
  kind: 'reported',
  inputTokens,
  cachedInputTokens: more.cached ?? null,
  cacheWriteTokens: null,
  outputTokens,
  reasoningTokens: more.reasoning ?? null,
});

let next = 0;
function turn(createdAt: string, pluginId: string, agentId: string, actualModel: string | null, usage: TurnUsage): void {
  next += 1;
  storage.generations.insertUsage({
    generationId: `g${String(next)}`,
    agentId,
    threadId: 't1',
    pluginId,
    accountKey: 'acct',
    actualModel,
    usage,
    outcome: { kind: 'completed', finishReason: 'stop' },
    createdAt,
  });
}

it('sums turns per provider, agent and model inside the range, keeping unreported counts null', () => {
  turn('2026-03-31T11:00:00.000Z', 'provider-claude', 'a1', 'opus', reported(10, 5, { cached: 100 }));
  turn('2026-03-31T10:00:00.000Z', 'provider-claude', 'a1', 'opus', reported(20, 7));
  turn('2026-03-31T09:00:00.000Z', 'provider-claude', 'a1', 'opus', { kind: 'unavailable' });
  turn('2026-03-30T12:00:00.000Z', 'provider-antigravity', 'a2', null, reported(4, 1, { reasoning: 3 }));
  turn('2026-03-28T00:00:00.000Z', 'provider-antigravity', 'a2', null, { kind: 'unavailable' });
  turn('2026-01-01T00:00:00.000Z', 'provider-openai', 'a1', 'gpt', reported(1, 1));

  const shown = (range: '24h' | '7d' | 'all') => {
    const { since, totals } = storage.tokens.read(range);
    return { since, totals: totals.map((row) => [row.pluginId, row.agentId, row.model, row.turns, row.turnsWithoutCounts, row.inputTokens, row.cachedInputTokens, row.outputTokens, row.reasoningTokens].join(' ')) };
  };
  expect({ day: shown('24h'), week: shown('7d'), all: shown('all') }).toMatchInlineSnapshot(`
    {
      "all": {
        "since": null,
        "totals": [
          "provider-antigravity a2  2 1 4  1 3",
          "provider-claude a1 opus 3 1 30 100 12 ",
          "provider-openai a1 gpt 1 0 1  1 ",
        ],
      },
      "day": {
        "since": "2026-03-30T12:00:00.000Z",
        "totals": [
          "provider-antigravity a2  1 0 4  1 3",
          "provider-claude a1 opus 3 1 30 100 12 ",
        ],
      },
      "week": {
        "since": "2026-03-24T12:00:00.000Z",
        "totals": [
          "provider-antigravity a2  2 1 4  1 3",
          "provider-claude a1 opus 3 1 30 100 12 ",
        ],
      },
    }
  `);
});

it('reports nothing before any turn', () => {
  expect(storage.tokens.read('30d')).toEqual({ range: '30d', since: '2026-03-01T12:00:00.000Z', totals: [] });
});
