import type { TokenRange, TokenUsageResponse } from '@morrowbot/contracts';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ApiResult } from '../../shared/api.ts';
import { Icon } from '../../shared/ui/Icon.tsx';
import { LimitsTab } from './LimitsTab.tsx';
import { TokensTab, type TokensView } from './TokensTab.tsx';
import { reportsLimits, type TokenGrouping, type TokenNames, type UsageProvider } from './usage-view.ts';

type Tab = 'limits' | 'tokens';
const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: 'limits', label: 'Limits' },
  { id: 'tokens', label: 'Tokens' },
];
const ALL = '';

export interface UsageSectionProps {
  /** Null while the provider list loads. */
  readonly providers: readonly UsageProvider[] | null;
  /** Asks the host for a provider's limits again (`usage {refresh}`). */
  readonly onRefreshLimits: (id: string) => Promise<void>;
  readonly loadTokens: (range: TokenRange) => Promise<ApiResult<TokenUsageResponse>>;
  readonly agentName: (agentId: string) => string | null;
  readonly now?: () => number;
}

/** Settings › Usage (⌘U, spec §6.4): Limits and Tokens tabs, a provider filter and Refresh. */
export function UsageSection(props: UsageSectionProps) {
  const now = props.now ?? Date.now;
  const [tab, setTab] = useState<Tab>('limits');
  const [filter, setFilter] = useState(ALL);
  const [range, setRange] = useState<TokenRange>('7d');
  const [grouping, setGrouping] = useState<TokenGrouping>('provider');
  const [tokens, setTokens] = useState<TokensView>({ kind: 'loading' });
  const [tokensLoad, setTokensLoad] = useState(0);
  const [refreshing, setRefreshing] = useState<ReadonlySet<string>>(new Set());
  const tabs = useRef<HTMLDivElement>(null);
  const loadTokens = useRef(props.loadTokens);
  loadTokens.current = props.loadTokens;

  useEffect(() => {
    let current = true;
    setTokens({ kind: 'loading' });
    void loadTokens.current(range).then((result) => {
      if (!current) return;
      setTokens(result.kind === 'ok' ? { kind: 'loaded', totals: result.value.totals, at: new Date(now()).toISOString() } : { kind: 'failed', message: result.error.message });
    });
    return () => {
      current = false;
    };
  }, [range, tokensLoad]);

  const providers = props.providers ?? [];
  const shown = filter === ALL ? providers : providers.filter(({ id }) => id === filter);
  const names: TokenNames = { provider: (id) => providers.find((each) => each.id === id)?.name ?? id, agent: props.agentName };

  const refreshLimits = (ids: readonly string[]): void => {
    setRefreshing((current) => new Set([...current, ...ids]));
    for (const id of ids) {
      void props.onRefreshLimits(id).finally(() => {
        setRefreshing((current) => new Set([...current].filter((each) => each !== id)));
      });
    }
  };
  const refresh = (): void => {
    if (tab === 'tokens') setTokensLoad((count) => count + 1);
    else refreshLimits(shown.filter((each) => each.enabled && reportsLimits(each)).map(({ id }) => id));
  };
  const busy = tab === 'tokens' ? tokens.kind === 'loading' : shown.some(({ id }) => refreshing.has(id));

  return (
    <div class="usage-section">
      <div class="usage-bar">
        <div
          ref={tabs}
          class="usage-tabs"
          role="tablist"
          aria-label="Usage"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const next = tab === 'limits' ? 'tokens' : 'limits';
            setTab(next);
            tabs.current?.querySelector<HTMLElement>(`#usage-tab-${next}`)?.focus();
          }}
        >
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              id={`usage-tab-${id}`}
              type="button"
              role="tab"
              class="usage-tab"
              aria-selected={tab === id}
              aria-controls="usage-panel"
              tabIndex={tab === id ? 0 : -1}
              onClick={() => {
                setTab(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <span class="spacer" />
        <select
          class="usage-filter"
          aria-label="Provider"
          value={filter}
          onChange={(event) => {
            setFilter(event.currentTarget.value);
          }}
        >
          <option value={ALL}>All providers</option>
          {providers.map(({ id, name }) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <button type="button" class="btn secondary" disabled={busy} onClick={refresh}>
          <Icon name="refresh" />
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <div id="usage-panel" role="tabpanel" aria-labelledby={`usage-tab-${tab}`}>
        {tab === 'limits' ? (
          props.providers === null ? (
            <p class="usage-empty">Loading…</p>
          ) : (
            <LimitsTab
              providers={shown}
              refreshing={refreshing}
              onRetry={(id) => {
                refreshLimits([id]);
              }}
              now={now()}
            />
          )
        ) : (
          <TokensTab
            view={tokens.kind === 'loaded' && filter !== ALL ? { ...tokens, totals: tokens.totals.filter(({ pluginId }) => pluginId === filter) } : tokens}
            range={range}
            onRange={setRange}
            grouping={grouping}
            onGrouping={setGrouping}
            names={names}
          />
        )}
      </div>
    </div>
  );
}
