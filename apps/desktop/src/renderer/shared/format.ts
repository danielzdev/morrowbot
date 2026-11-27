/** A timestamp in the user's own locale and time zone. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A compact age for lists, such as "now", "5m", "3h", "2d", "3w", "4mo" or "1y". */
export function relativeTime(iso: string, now: number): string {
  const age = Math.max(0, now - Date.parse(iso));
  if (age < MINUTE) return 'now';
  if (age < HOUR) return `${String(Math.floor(age / MINUTE))}m`;
  if (age < DAY) return `${String(Math.floor(age / HOUR))}h`;
  if (age < 7 * DAY) return `${String(Math.floor(age / DAY))}d`;
  if (age < 35 * DAY) return `${String(Math.floor(age / (7 * DAY)))}w`;
  if (age < 365 * DAY) return `${String(Math.max(1, Math.floor(age / (30 * DAY))))}mo`;
  return `${String(Math.floor(age / (365 * DAY)))}y`;
}

/** Where and how dates are written; the user's own unless a test pins them. */
export interface DateZone {
  readonly locale?: string;
  readonly timeZone?: string;
}

/** A last message's time in a list: "11:24 AM" today, "Nov 26" this year, "Nov 26, 2025" before. */
export function messageTime(iso: string, now: number, zone: DateZone = {}): string {
  const at = new Date(iso);
  const day = (date: Date): string => date.toLocaleDateString('en-CA', { timeZone: zone.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  if (day(at) === day(new Date(now))) return at.toLocaleTimeString(zone.locale, { timeZone: zone.timeZone, hour: 'numeric', minute: '2-digit' });
  const sameYear = day(at).slice(0, 4) === day(new Date(now)).slice(0, 4);
  return at.toLocaleDateString(zone.locale, { timeZone: zone.timeZone, month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}
