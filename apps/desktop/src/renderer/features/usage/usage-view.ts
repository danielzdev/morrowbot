import type { ProviderInfo, TokenTotals, UsageResponse } from '@morrowbot/contracts';
import type { Loadable } from '../../shared/store.ts';
import { DELETED_AGENT, NO_MODEL, type LimitReason } from './usage-copy.ts';

/** A provider as Settings › Usage sees it; the app builds these from the plugins model. */
export interface UsageProvider {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  /** Null when the host gave no info (the plugin is off or not running). */
  readonly info: Loadable<ProviderInfo> | null;
  /** The last usage reply; null when the host gave none. */
  readonly usage: UsageResponse | null;
}

/**
 * Providers that never report plan limits (v23 §5). Ori Kami never asks Google's internal Code
 * Assist endpoint for Antigravity's quota, so these always show the unsupported card.
 */
const NO_QUOTA: ReadonlySet<string> = new Set(['provider-antigravity', 'provider-opencode']);

export interface LimitWindow {
  readonly id: string;
  readonly label: string;
  readonly usedPercent: number;
  readonly resetsAt: string | null;
  /** The models a window covers, or null for the whole account. */
  readonly models: readonly string[] | null;
}

/** What one provider's Limits group shows. Only `windows` draws bars. */
export type LimitsCard =
  | { readonly kind: 'checking' }
  | { readonly kind: 'windows'; readonly observedAt: string; readonly stale: boolean; readonly windows: readonly LimitWindow[] }
  | { readonly kind: 'reason'; readonly reason: LimitReason };

/** Whether asking this provider for its limits can ever show a bar; Refresh skips the others. */
export function reportsLimits(provider: Pick<UsageProvider, 'id' | 'info'>): boolean {
  if (NO_QUOTA.has(provider.id)) return false;
  const info = provider.info?.kind === 'loaded' ? provider.info.value : undefined;
  return !((info?.kind === 'ready' || info?.kind === 'ready-models-later') && info.capabilities.usage === 'none');
}

/** The Limits card for one provider, from only what the host reported (spec §0 rule 1, §6.4). */
export function limitsOf(provider: UsageProvider): LimitsCard {
  if (!reportsLimits(provider)) return { kind: 'reason', reason: 'unsupported' };
  if (!provider.enabled) return { kind: 'reason', reason: 'turned-off' };
  const { usage, info } = provider;
  if (usage === null) {
    if (info?.kind === 'loading') return { kind: 'checking' };
    return { kind: 'reason', reason: info?.kind === 'loaded' && info.value.kind === 'signed-out' ? 'signed-out' : 'no-reply' };
  }
  const result = usage.usage;
  switch (result.kind) {
    case 'unavailable':
      return { kind: 'reason', reason: result.reason };
    case 'available':
      if (result.windows.length === 0) return { kind: 'reason', reason: 'not-yet-observed' };
      return {
        kind: 'windows',
        observedAt: result.observedAt,
        stale: usage.stale,
        windows: result.windows.map((window) => ({
          id: window.id,
          label: window.label,
          usedPercent: window.usedPercent,
          resetsAt: window.resetsAt,
          models: window.scope.kind === 'models' ? window.scope.modelIds : null,
        })),
      };
  }
}

export type TokenGrouping = 'provider' | 'model' | 'agent';

/** One row of the Tokens table. A sum is null when no turn in the row reported it. */
export interface TokenRow {
  readonly key: string;
  readonly label: string;
  /** The provider beside a model; '' otherwise. */
  readonly detail: string;
  readonly turns: number;
  readonly turnsWithoutCounts: number;
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
}

export interface TokenNames {
  readonly provider: (pluginId: string) => string;
  /** Null for an agent that was deleted since. */
  readonly agent: (agentId: string) => string | null;
}

const add = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : a + b);

/** The host's per-(provider, agent, model) sums, regrouped for the table, biggest first. */
export function groupTokens(totals: readonly TokenTotals[], by: TokenGrouping, names: TokenNames): readonly TokenRow[] {
  const rows = new Map<string, TokenRow>();
  for (const each of totals) {
    const head = ((): Pick<TokenRow, 'key' | 'label' | 'detail'> => {
      switch (by) {
        case 'provider':
          return { key: each.pluginId, label: names.provider(each.pluginId), detail: '' };
        case 'model':
          return { key: `${each.pluginId}\n${each.model ?? ''}`, label: each.model ?? NO_MODEL, detail: names.provider(each.pluginId) };
        case 'agent':
          return { key: each.agentId, label: names.agent(each.agentId) ?? DELETED_AGENT, detail: '' };
      }
    })();
    const prior = rows.get(head.key);
    rows.set(head.key, {
      ...head,
      turns: (prior?.turns ?? 0) + each.turns,
      turnsWithoutCounts: (prior?.turnsWithoutCounts ?? 0) + each.turnsWithoutCounts,
      inputTokens: add(prior?.inputTokens ?? null, each.inputTokens),
      cachedInputTokens: add(prior?.cachedInputTokens ?? null, each.cachedInputTokens),
      outputTokens: add(prior?.outputTokens ?? null, each.outputTokens),
      reasoningTokens: add(prior?.reasoningTokens ?? null, each.reasoningTokens),
    });
  }
  const size = (row: TokenRow): number => (row.inputTokens ?? 0) + (row.cachedInputTokens ?? 0) + (row.outputTokens ?? 0);
  return [...rows.values()].sort((a, b) => size(b) - size(a) || b.turns - a.turns || a.label.localeCompare(b.label));
}
