import type { TurnUsage } from '@morrowbot/plugin-sdk';
import type { TokenUsageBreakdown, TokenUsageUpdated } from './protocol.ts';

/** Where a turn's count starts from, known when `turn/start` is sent. */
export type Baseline =
  /** The thread was created by this turn's `thread/start`. */
  | { readonly kind: 'new-thread' }
  /** The last total this daemon reported for the thread. */
  | { readonly kind: 'seen'; readonly total: TokenUsageBreakdown }
  /** Nothing seen: the total before this turn's first request is worked out from its first update. */
  | { readonly kind: 'unknown' };

/**
 * Counts one turn's tokens as the difference between the thread's cumulative totals at turn start
 * and turn end. Updates of other turns (a cold resume replays the last one) move the baseline only.
 */
export interface TokenCounter {
  /** Hears a `thread/tokenUsage/updated` for this turn's thread. */
  observe(update: TokenUsageUpdated): void;
  /** This turn's usage, or `unavailable` when no update came or the baseline cannot be trusted. */
  usage(): TurnUsage;
}

const ZERO: TokenUsageBreakdown = { inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 };

export function countTokens(baseline: Baseline, turnId: () => string | null): TokenCounter {
  let base: TokenUsageBreakdown | undefined = baseline.kind === 'new-thread' ? ZERO : baseline.kind === 'seen' ? baseline.total : undefined;
  let first: TokenUsageUpdated | undefined;
  let latest: TokenUsageBreakdown | undefined;
  return {
    observe: (update) => {
      if (update.turnId !== turnId()) {
        if (first === undefined && baseline.kind !== 'new-thread') base = update.tokenUsage.total;
        return;
      }
      first ??= update;
      latest = update.tokenUsage.total;
    },
    usage: () => {
      if (latest === undefined || first === undefined) return { kind: 'unavailable' };
      const start = base ?? beforeFirst(first);
      if (start === undefined) return { kind: 'unavailable' };
      const delta = difference(latest, start);
      if (delta === undefined) return { kind: 'unavailable' };
      return {
        kind: 'reported',
        inputTokens: Math.max(0, delta.inputTokens - delta.cachedInputTokens),
        cachedInputTokens: delta.cachedInputTokens,
        cacheWriteTokens: latest.cacheWriteInputTokens === null || latest.cacheWriteInputTokens === undefined ? null : (delta.cacheWriteInputTokens ?? 0),
        outputTokens: delta.outputTokens,
        reasoningTokens: delta.reasoningOutputTokens,
      };
    },
  };
}

/** `total − last` of the turn's first update: the total before its first request, when no counter goes negative. */
function beforeFirst(update: TokenUsageUpdated): TokenUsageBreakdown | undefined {
  return difference(update.tokenUsage.total, update.tokenUsage.last);
}

function difference(a: TokenUsageBreakdown, b: TokenUsageBreakdown): TokenUsageBreakdown | undefined {
  const delta = {
    inputTokens: a.inputTokens - b.inputTokens,
    cachedInputTokens: a.cachedInputTokens - b.cachedInputTokens,
    cacheWriteInputTokens: (a.cacheWriteInputTokens ?? 0) - (b.cacheWriteInputTokens ?? 0),
    outputTokens: a.outputTokens - b.outputTokens,
    reasoningOutputTokens: a.reasoningOutputTokens - b.reasoningOutputTokens,
  };
  const counts = [delta.inputTokens, delta.cachedInputTokens, delta.cacheWriteInputTokens, delta.outputTokens, delta.reasoningOutputTokens];
  return counts.every((count) => Number.isInteger(count) && count >= 0) ? delta : undefined;
}
