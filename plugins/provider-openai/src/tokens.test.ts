import { expect, it } from 'vitest';
import type { TokenUsageBreakdown, TokenUsageUpdated } from './protocol.ts';
import { countTokens, type Baseline } from './tokens.ts';

/** input, cached input, output, reasoning; cache writes are not reported. */
const usage = (input: number, cached: number, output: number, reasoning: number): TokenUsageBreakdown => ({
  inputTokens: input,
  cachedInputTokens: cached,
  cacheWriteInputTokens: null,
  outputTokens: output,
  reasoningOutputTokens: reasoning,
});

const update = (turnId: string, total: TokenUsageBreakdown, last: TokenUsageBreakdown): TokenUsageUpdated => ({ threadId: 't', turnId, tokenUsage: { total, last } });

function count(baseline: Baseline, updates: readonly TokenUsageUpdated[]): unknown {
  const counter = countTokens(baseline, () => 'now');
  for (const each of updates) counter.observe(each);
  return counter.usage();
}

const SEEN: Baseline = { kind: 'seen', total: usage(1000, 600, 100, 40) };

it('counts a turn as the change in the thread total, from a known start or from its first update', () => {
  expect({
    newThreadTwoRequests: count({ kind: 'new-thread' }, [update('now', usage(100, 60, 10, 4), usage(100, 60, 10, 4)), update('now', usage(250, 150, 30, 9), usage(150, 90, 20, 5))]),
    seenTotal: count(SEEN, [update('now', usage(1100, 660, 110, 44), usage(100, 60, 10, 4))]),
    coldResumeReplaysLastTurnFirst: count({ kind: 'unknown' }, [update('old', usage(1000, 600, 100, 40), usage(100, 60, 10, 4)), update('now', usage(1100, 660, 110, 44), usage(100, 60, 10, 4))]),
    coldResumeNoReplay: count({ kind: 'unknown' }, [update('now', usage(1100, 660, 110, 44), usage(100, 60, 10, 4)), update('now', usage(1300, 800, 120, 50), usage(200, 140, 10, 6))]),
    replayAfterFirstUpdateIsIgnored: count(SEEN, [update('now', usage(1100, 660, 110, 44), usage(100, 60, 10, 4)), update('old', usage(1050, 600, 100, 40), usage(50, 0, 0, 0))]),
  }).toMatchInlineSnapshot(`
    {
      "coldResumeNoReplay": {
        "cacheWriteTokens": null,
        "cachedInputTokens": 200,
        "inputTokens": 100,
        "kind": "reported",
        "outputTokens": 20,
        "reasoningTokens": 10,
      },
      "coldResumeReplaysLastTurnFirst": {
        "cacheWriteTokens": null,
        "cachedInputTokens": 60,
        "inputTokens": 40,
        "kind": "reported",
        "outputTokens": 10,
        "reasoningTokens": 4,
      },
      "newThreadTwoRequests": {
        "cacheWriteTokens": null,
        "cachedInputTokens": 150,
        "inputTokens": 100,
        "kind": "reported",
        "outputTokens": 30,
        "reasoningTokens": 9,
      },
      "replayAfterFirstUpdateIsIgnored": {
        "cacheWriteTokens": null,
        "cachedInputTokens": 60,
        "inputTokens": 40,
        "kind": "reported",
        "outputTokens": 10,
        "reasoningTokens": 4,
      },
      "seenTotal": {
        "cacheWriteTokens": null,
        "cachedInputTokens": 60,
        "inputTokens": 40,
        "kind": "reported",
        "outputTokens": 10,
        "reasoningTokens": 4,
      },
    }
  `);
});

it('is unavailable when no update came, a counter went backwards, or the first update cannot give a start', () => {
  expect({
    noUpdates: count(SEEN, []),
    onlyAnotherTurn: count({ kind: 'unknown' }, [update('old', usage(1000, 600, 100, 40), usage(100, 60, 10, 4))]),
    totalBelowSeen: count(SEEN, [update('now', usage(900, 660, 110, 44), usage(100, 60, 10, 4))]),
    lastAboveTotal: count({ kind: 'unknown' }, [update('now', usage(100, 60, 10, 4), usage(200, 60, 10, 4))]),
  }).toMatchInlineSnapshot(`
    {
      "lastAboveTotal": {
        "kind": "unavailable",
      },
      "noUpdates": {
        "kind": "unavailable",
      },
      "onlyAnotherTurn": {
        "kind": "unavailable",
      },
      "totalBelowSeen": {
        "kind": "unavailable",
      },
    }
  `);
});

it('reports cache writes only when Codex counts them', () => {
  const written = { ...usage(100, 60, 10, 4), cacheWriteInputTokens: 30 };
  expect(count({ kind: 'new-thread' }, [update('now', written, written)])).toMatchInlineSnapshot(`
    {
      "cacheWriteTokens": 30,
      "cachedInputTokens": 60,
      "inputTokens": 40,
      "kind": "reported",
      "outputTokens": 10,
      "reasoningTokens": 4,
    }
  `);
});
