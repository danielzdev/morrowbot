import { until } from './daemon-fixture.ts';

/** Reads `log` until it holds `method` at least `count` times, and returns what it read last. */
export async function loggedTimes<Entry extends { readonly method: string }>(log: () => Promise<Entry[]>, method: string, count: number): Promise<Entry[]> {
  let entries: Entry[] = [];
  await until(async () => {
    entries = await log();
    return entries.filter((entry) => entry.method === method).length >= count;
  });
  return entries;
}
