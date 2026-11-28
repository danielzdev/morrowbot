import { useEffect, useState } from 'react';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A compact age for lists, such as "now", "5m", "3h", "2d", "3w", "4mo" or "1y" (as on desktop). */
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

/** The current time, refreshed every minute so list ages stay current. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, MINUTE);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}
