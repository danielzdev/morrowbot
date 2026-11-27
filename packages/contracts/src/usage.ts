import { z } from 'zod';
import { EntityId, PluginId, Timestamp } from './ids.ts';

/** How far back Settings › Usage › Tokens counts. */
export const TokenRange = z.enum(['24h', '7d', '30d', 'all']);
export type TokenRange = z.infer<typeof TokenRange>;

/** A token sum; null when no turn in the group reported that count. */
const Sum = z.number().int().nonnegative().nullable();

/** Local token counts for one (provider, agent, reported model). `inputTokens` excludes cached input. */
export const TokenTotals = z.strictObject({
  pluginId: PluginId,
  agentId: EntityId,
  /** The model the provider said it used; null when it did not say. */
  model: z.string().min(1).nullable(),
  turns: z.number().int().positive(),
  turnsWithoutCounts: z.number().int().nonnegative(),
  inputTokens: Sum,
  cachedInputTokens: Sum,
  outputTokens: Sum,
  reasoningTokens: Sum,
});
export type TokenTotals = z.infer<typeof TokenTotals>;

export const TokenUsageResponse = z.strictObject({
  range: TokenRange,
  /** The earliest turn counted; null for `all`. */
  since: Timestamp.nullable(),
  totals: z.array(TokenTotals),
});
export type TokenUsageResponse = z.infer<typeof TokenUsageResponse>;
