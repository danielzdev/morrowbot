import type { TokenRange, UsageUnavailableReason } from '@morrowbot/contracts';
import type { DateZone } from '../../shared/format.ts';

/** Why a provider shows no limit bars: the host's reasons, `turned-off`, and `no-reply` when the host gave no answer. */
export type LimitReason = UsageUnavailableReason | 'turned-off' | 'no-reply';

/** One card per reason; none of them shows a bar, ring or percentage (spec §6.4). */
export const REASON_COPY: Readonly<Record<LimitReason, string>> = {
  unsupported: "Quota unavailable: this provider doesn't report usage limits.",
  'api-key-route': "Plan limits aren't available for this route.",
  'signed-out': 'Sign in to see limits.',
  'not-yet-observed': 'No limits reported yet.',
  'probe-failed': "Couldn't check limits.",
  'turned-off': 'Turned off. Turn it on in Extensions to see its limits.',
  'no-reply': "Couldn't check limits.",
};

/** Reasons that offer Try again. */
export const RETRY_REASONS: ReadonlySet<LimitReason> = new Set<LimitReason>(['probe-failed', 'no-reply']);

export const RANGE_LABELS: Readonly<Record<TokenRange, string>> = { '24h': '24h', '7d': '7d', '30d': '30d', all: 'All' };

export const NO_MODEL = 'Model not reported';
export const DELETED_AGENT = 'Deleted agent';
export const NO_TOKENS = 'No turns in this range yet.';
export const TOKENS_FAILED = "Couldn't load token counts.";
export const WITHOUT_COUNTS_NOTE = "The provider didn't report token counts for these turns.";

const clock = (iso: string, zone: DateZone): string => new Date(iso).toLocaleTimeString(zone.locale, { timeZone: zone.timeZone, hour: 'numeric', minute: '2-digit' });

/** "as of 10:42", with "· may be out of date" for a stale snapshot. */
export function asOfLabel(iso: string, stale: boolean, zone: DateZone = {}): string {
  return `as of ${clock(iso, zone)}${stale ? ' · may be out of date' : ''}`;
}

export function leftLabel(usedPercent: number): string {
  return `${String(Math.max(0, Math.round(100 - usedPercent)))}% left`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The reset chip: "Resets in 2h 5m" within a day, "Resets Nov 28" later. */
export function resetLabel(iso: string, now: number, zone: DateZone = {}): string {
  const left = Date.parse(iso) - now;
  if (left <= 0) return 'Resets soon';
  if (left < HOUR) return `Resets in ${String(Math.max(1, Math.round(left / MINUTE)))}m`;
  if (left < 24 * HOUR) return `Resets in ${String(Math.floor(left / HOUR))}h ${String(Math.floor((left % HOUR) / MINUTE))}m`;
  return `Resets ${new Date(iso).toLocaleDateString(zone.locale, { timeZone: zone.timeZone, month: 'short', day: 'numeric' })}`;
}

export function withoutCountsLabel(turns: number): string {
  return `${String(turns)} ${turns === 1 ? 'turn' : 'turns'} without counts`;
}

/** A token count with digit grouping; "—" when no turn reported it. */
export function tokenCount(count: number | null): string {
  return count === null ? '—' : count.toLocaleString('en-US');
}
