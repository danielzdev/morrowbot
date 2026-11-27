import type { DatabaseSync } from 'node:sqlite';
import { TokenTotals, type TokenRange, type TokenUsageResponse } from '@morrowbot/contracts';
import { z } from 'zod';

const HOUR_MS = 3_600_000;
const SPAN_MS: Readonly<Record<Exclude<TokenRange, 'all'>, number>> = { '24h': 24 * HOUR_MS, '7d': 7 * 24 * HOUR_MS, '30d': 30 * 24 * HOUR_MS };

const TotalsRow = z
  .object({
    plugin_id: z.string(),
    agent_id: z.string(),
    actual_model: z.string().nullable(),
    turns: z.number(),
    without_counts: z.number(),
    input_tokens: z.number().nullable(),
    cached_input_tokens: z.number().nullable(),
    output_tokens: z.number().nullable(),
    reasoning_tokens: z.number().nullable(),
  })
  .transform((row) => ({
    pluginId: row.plugin_id,
    agentId: row.agent_id,
    model: row.actual_model === '' ? null : row.actual_model,
    turns: row.turns,
    turnsWithoutCounts: row.without_counts,
    inputTokens: row.input_tokens,
    cachedInputTokens: row.cached_input_tokens,
    outputTokens: row.output_tokens,
    reasoningTokens: row.reasoning_tokens,
  }))
  .pipe(TokenTotals);

/** Sums of the local `turn_usage` rows, for Settings › Usage › Tokens. */
export interface TokenTotalsRepository {
  read(range: TokenRange): TokenUsageResponse;
}

export function tokenTotalsRepository(db: DatabaseSync, now: () => string): TokenTotalsRepository {
  const totals = db.prepare(
    `SELECT plugin_id, agent_id, actual_model, COUNT(*) AS turns,
       SUM(input_tokens IS NULL) AS without_counts,
       SUM(input_tokens) AS input_tokens, SUM(cached_input_tokens) AS cached_input_tokens,
       SUM(output_tokens) AS output_tokens, SUM(reasoning_tokens) AS reasoning_tokens
     FROM turn_usage WHERE created_at >= ?
     GROUP BY plugin_id, agent_id, actual_model
     ORDER BY plugin_id, agent_id, actual_model`,
  );
  return {
    read: (range) => {
      const since = range === 'all' ? null : new Date(Date.parse(now()) - SPAN_MS[range]).toISOString();
      return { range, since, totals: totals.all(since ?? '').map((row) => TotalsRow.parse(row)) };
    },
  };
}
