import type { DateZone } from '../../shared/format.ts';
import { asOfLabel, leftLabel, REASON_COPY, resetLabel, RETRY_REASONS } from './usage-copy.ts';
import { limitsOf, type LimitWindow, type UsageProvider } from './usage-view.ts';

function WindowCard(props: { readonly window: LimitWindow; readonly now: number; readonly zone: DateZone }) {
  const { window } = props;
  const left = Math.max(0, Math.min(100, 100 - window.usedPercent));
  return (
    <div class="limit-card">
      <div class="limit-head">
        <span class="limit-label">{window.label}</span>
        <span class="limit-left">{leftLabel(window.usedPercent)}</span>
      </div>
      <div
        class="limit-bar"
        role="meter"
        aria-label={`${window.label}: ${leftLabel(window.usedPercent)}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(left)}
      >
        <div style={{ width: `${String(left)}%` }} />
      </div>
      <div class="limit-foot">
        {window.models !== null && <span class="limit-models">{window.models.join(', ')}</span>}
        {window.resetsAt !== null && <span class="limit-reset">{resetLabel(window.resetsAt, props.now, props.zone)}</span>}
      </div>
    </div>
  );
}

function ProviderLimits(props: {
  readonly provider: UsageProvider;
  readonly refreshing: boolean;
  readonly onRetry: () => void;
  readonly now: number;
  readonly zone: DateZone;
}) {
  const card = limitsOf(props.provider);
  const body = (() => {
    switch (card.kind) {
      case 'checking':
        return <p class="limit-reason">Checking…</p>;
      case 'reason':
        return (
          <div class="limit-card reason">
            <p class="limit-reason">{REASON_COPY[card.reason]}</p>
            {RETRY_REASONS.has(card.reason) && (
              <button type="button" class="btn secondary" disabled={props.refreshing} onClick={props.onRetry}>
                {props.refreshing ? 'Trying…' : 'Try again'}
              </button>
            )}
          </div>
        );
      case 'windows':
        return (
          <>
            <p class="usage-asof">{asOfLabel(card.observedAt, card.stale, props.zone)}</p>
            <div class="limit-grid">
              {card.windows.map((window) => (
                <WindowCard key={window.id} window={window} now={props.now} zone={props.zone} />
              ))}
            </div>
          </>
        );
    }
  })();
  return (
    <section class="usage-group" aria-label={props.provider.name}>
      <h3 class="usage-group-title">{props.provider.name}</h3>
      {body}
    </section>
  );
}

/** Settings › Usage › Limits: one group per provider, with bars only for reported windows (spec §6.4). */
export function LimitsTab(props: {
  readonly providers: readonly UsageProvider[];
  readonly refreshing: ReadonlySet<string>;
  readonly onRetry: (id: string) => void;
  readonly now: number;
  readonly zone?: DateZone;
}) {
  if (props.providers.length === 0) return <p class="usage-empty">No providers yet. Providers you add show their limits here.</p>;
  return (
    <div class="usage-limits">
      {props.providers.map((provider) => (
        <ProviderLimits
          key={provider.id}
          provider={provider}
          refreshing={props.refreshing.has(provider.id)}
          onRetry={() => {
            props.onRetry(provider.id);
          }}
          now={props.now}
          zone={props.zone ?? {}}
        />
      ))}
    </div>
  );
}
