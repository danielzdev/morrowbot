import type { TokenRange, TokenTotals } from '@morrowbot/contracts';
import type { DateZone } from '../../shared/format.ts';
import { Segmented } from '../../shared/ui/Segmented.tsx';
import { asOfLabel, NO_TOKENS, RANGE_LABELS, tokenCount, TOKENS_FAILED, WITHOUT_COUNTS_NOTE, withoutCountsLabel } from './usage-copy.ts';
import { groupTokens, type TokenGrouping, type TokenNames, type TokenRow } from './usage-view.ts';

/** The Tokens tab's data: loading, the host's sums as of a time, or why they did not load. */
export type TokensView =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly totals: readonly TokenTotals[]; readonly at: string }
  | { readonly kind: 'failed'; readonly message: string };

const RANGES: readonly TokenRange[] = ['24h', '7d', '30d', 'all'];
const GROUPINGS: readonly { readonly value: TokenGrouping; readonly label: string }[] = [
  { value: 'provider', label: 'Provider' },
  { value: 'model', label: 'Model' },
  { value: 'agent', label: 'Agent' },
];
const COLUMNS: readonly string[] = ['Turns', 'Input', 'Cached input', 'Output', 'Reasoning'];

function Row({ row }: { readonly row: TokenRow }) {
  return (
    <tr>
      <th scope="row">
        <span class="tokens-name">{row.label}</span>
        {row.detail !== '' && <span class="tokens-detail">{row.detail}</span>}
        {row.turnsWithoutCounts > 0 && <span class="tokens-detail">{withoutCountsLabel(row.turnsWithoutCounts)}</span>}
      </th>
      <td>{row.turns.toLocaleString('en-US')}</td>
      <td>{tokenCount(row.inputTokens)}</td>
      <td>{tokenCount(row.cachedInputTokens)}</td>
      <td>{tokenCount(row.outputTokens)}</td>
      <td>{tokenCount(row.reasoningTokens)}</td>
    </tr>
  );
}

/**
 * Settings › Usage › Tokens: local counts from `turn_usage` by provider, model or agent over a range
 * (spec §6.4). Counts only what providers reported; turns without counts are named, never guessed. No cost.
 */
export function TokensTab(props: {
  readonly view: TokensView;
  readonly range: TokenRange;
  readonly onRange: (range: TokenRange) => void;
  readonly grouping: TokenGrouping;
  readonly onGrouping: (grouping: TokenGrouping) => void;
  readonly names: TokenNames;
  readonly zone?: DateZone;
}) {
  const { view } = props;
  const rows = view.kind === 'loaded' ? groupTokens(view.totals, props.grouping, props.names) : [];
  const without = rows.reduce((total, row) => total + row.turnsWithoutCounts, 0);
  return (
    <div class="usage-tokens">
      <div class="usage-controls">
        <Segmented label="Time range" value={props.range} options={RANGES.map((value) => ({ value, label: RANGE_LABELS[value] }))} onChange={props.onRange} />
        <Segmented label="Group by" value={props.grouping} options={GROUPINGS} onChange={props.onGrouping} />
      </div>
      {view.kind === 'loading' && <p class="usage-empty">Loading…</p>}
      {view.kind === 'failed' && (
        <p class="usage-empty" role="alert">
          {TOKENS_FAILED} {view.message}
        </p>
      )}
      {view.kind === 'loaded' && (
        <>
          <p class="usage-asof">{asOfLabel(view.at, false, props.zone)}</p>
          {rows.length === 0 ? (
            <p class="usage-empty">{NO_TOKENS}</p>
          ) : (
            <table class="tokens-table">
              <thead>
                <tr>
                  <th scope="col">{GROUPINGS.find(({ value }) => value === props.grouping)?.label}</th>
                  {COLUMNS.map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Row key={row.key} row={row} />
                ))}
              </tbody>
            </table>
          )}
          {without > 0 && (
            <p class="usage-note">
              {withoutCountsLabel(without)}. {WITHOUT_COUNTS_NOTE}
            </p>
          )}
        </>
      )}
    </div>
  );
}
