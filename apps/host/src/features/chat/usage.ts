import type { UsageResponse, UsageResult } from '@morrowbot/contracts';
import { laneKey, type ChatCore } from './turn.ts';

const STALE_AFTER_MS = 15 * 60_000;

export type UsageAnswer = { readonly kind: 'ok'; readonly response: UsageResponse } | { readonly kind: 'unavailable'; readonly reason: string };

/**
 * A plugin's usage as the usage bar shows it. Live windows are saved per account and window; the
 * saved snapshot is served (marked stale when old) only for an account the current worker has
 * validated, and never for '' (live-only) or for a reply that says the route has no quota.
 */
export async function readUsage(core: ChatCore, pluginId: string, refresh: boolean): Promise<UsageAnswer> {
  const { plugins, store } = core.options;
  const answer = await plugins.usage(pluginId, refresh);
  if (answer.kind === 'unavailable') return answer;
  const live = answer.usage;
  if (live.accountKey === '') {
    const kept = core.liveUsage.get(pluginId);
    const usage = live.kind === 'unavailable' && live.reason === 'not-yet-observed' && kept !== undefined ? kept : live;
    return { kind: 'ok', response: { usage, stale: false, persisted: false } };
  }
  const fenced = core.fenced.has(laneKey(pluginId, live.accountKey));
  if (live.kind === 'available' && !fenced) store.usage.merge(pluginId, live.accountKey, live.observedAt, live.windows);
  const info = plugins.cachedInfo(pluginId);
  const validated = info?.worker === answer.worker && (info.info.kind === 'ready' || info.info.kind === 'ready-models-later') && info.info.accountKey === live.accountKey;
  if (fenced || !validated || !servesSnapshot(live)) return { kind: 'ok', response: { usage: live, stale: false, persisted: false } };
  const saved = store.usage.read(pluginId, live.accountKey);
  if (saved === undefined) return { kind: 'ok', response: { usage: live, stale: false, persisted: false } };
  const age = Date.parse(core.options.now()) - Date.parse(saved.observedAt);
  return {
    kind: 'ok',
    response: {
      usage: { kind: 'available', observedAt: saved.observedAt, accountKey: live.accountKey, windows: [...saved.windows] },
      stale: live.kind !== 'available' || age > STALE_AFTER_MS,
      persisted: true,
    },
  };
}

function servesSnapshot(usage: UsageResult): boolean {
  switch (usage.kind) {
    case 'available':
      return true;
    case 'unavailable':
      return usage.reason === 'not-yet-observed' || usage.reason === 'probe-failed';
  }
}
