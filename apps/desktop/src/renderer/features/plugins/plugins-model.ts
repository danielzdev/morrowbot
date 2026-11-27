import type { EventServerFrame, PluginConfig, PluginEntry, ProviderInfo, UsageResponse } from '@morrowbot/contracts';
import type { MorrowbotBridge } from '../../bridge.ts';
import type { Api } from '../../shared/api.ts';
import { Store, type Loadable } from '../../shared/store.ts';

export interface PluginCard {
  readonly entry: PluginEntry;
  /** Null for a plugin that is not a provider. */
  readonly info: Loadable<ProviderInfo> | null;
  readonly usage: UsageResponse | null;
  readonly busy: 'rechecking' | 'saving' | 'releasing' | null;
  /** Why the last action on this plugin did not work. */
  readonly problem: string | null;
}

export interface PluginsModel {
  readonly cards: Store<Loadable<readonly PluginCard[]>>;
  load(): Promise<void>;
  refreshInfo(id: string): Promise<void>;
  recheck(id: string): Promise<void>;
  setConfig(id: string, config: PluginConfig): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  release(id: string, regId: string): Promise<void>;
  close(): void;
}

export interface PluginsModelOptions {
  readonly api: Api;
  readonly bridge: Pick<MorrowbotBridge, 'onEvent' | 'onHostReady'>;
  readonly blockedRefreshMs?: number;
  /** After a Release, which can free chats that other screens show. */
  readonly onReleased?: () => void;
}

const isProvider = (entry: PluginEntry): boolean => entry.manifest.kind === 'provider';
const isRunning = (entry: PluginEntry): boolean => entry.enabled && entry.status.kind === 'running';

export function createPluginsModel(options: PluginsModelOptions): PluginsModel {
  const { api } = options;
  const cards = new Store<Loadable<readonly PluginCard[]>>({ kind: 'loading' });
  let blockedTimer: ReturnType<typeof setTimeout> | undefined;
  let loads = 0;
  let closed = false;

  const card = (id: string): PluginCard | undefined => {
    const current = cards.get();
    return current.kind === 'loaded' ? current.value.find(({ entry }) => entry.manifest.id === id) : undefined;
  };
  const patch = (id: string, change: Partial<PluginCard>): void => {
    cards.update((current) =>
      current.kind === 'loaded'
        ? { kind: 'loaded', value: current.value.map((each) => (each.entry.manifest.id === id ? { ...each, ...change } : each)) }
        : current,
    );
  };

  async function fetchInfo(id: string, refresh: boolean): Promise<Loadable<ProviderInfo>> {
    const result = await api.providerInfo(id, refresh);
    return result.kind === 'ok' ? { kind: 'loaded', value: result.value.info } : { kind: 'failed', message: result.error.message };
  }

  async function fetchUsage(id: string): Promise<UsageResponse | null> {
    const result = await api.usage(id, false);
    return result.kind === 'ok' ? result.value : null;
  }

  /** A card's entry, info and usage as the host has them now; `busy` and `problem` belong to the caller. */
  async function fetchCard(entry: PluginEntry): Promise<Omit<PluginCard, 'busy' | 'problem'>> {
    if (!isProvider(entry)) return { entry, info: null, usage: null };
    if (!isRunning(entry)) return { entry, info: { kind: 'failed', message: 'The plugin is not running.' }, usage: null };
    const [info, usage] = await Promise.all([fetchInfo(entry.manifest.id, false), fetchUsage(entry.manifest.id)]);
    return { entry, info, usage };
  }

  function watchBlocked(list: readonly PluginCard[]): void {
    clearTimeout(blockedTimer);
    if (list.some(({ entry }) => entry.blockedGroups.length > 0)) {
      blockedTimer = setTimeout(() => void load(), options.blockedRefreshMs ?? 5_000);
    }
  }

  async function load(): Promise<void> {
    const mine = ++loads;
    const result = await api.listPlugins();
    const fetched = result.kind === 'ok' ? await Promise.all(result.value.plugins.map(fetchCard)) : [];
    if (mine !== loads || closed) return;
    if (result.kind === 'failed') {
      cards.set({ kind: 'failed', message: result.error.message });
      return;
    }
    const list = fetched.map((next) => {
      const live = card(next.entry.manifest.id);
      return { ...next, busy: live?.busy ?? null, problem: live?.problem ?? null };
    });
    cards.set({ kind: 'loaded', value: list });
    watchBlocked(list);
  }

  /** Replaces one plugin's entry after a change, and fetches its info again. */
  async function reloadOne(entry: PluginEntry, problem: string | null): Promise<void> {
    const next = await fetchCard(entry);
    loads++;
    patch(entry.manifest.id, { ...next, busy: null, problem });
  }

  const stopEvents = options.bridge.onEvent((frame: EventServerFrame) => {
    if (frame.kind !== 'usage.updated') return;
    void fetchUsage(frame.pluginId).then((usage) => {
      patch(frame.pluginId, { usage });
    });
  });
  const stopRestarts = options.bridge.onHostReady(() => void load());

  return {
    cards,
    load,
    refreshInfo: async (id) => {
      patch(id, { info: await fetchInfo(id, false) });
    },
    recheck: async (id) => {
      if (card(id)?.busy != null) return;
      patch(id, { busy: 'rechecking', problem: null });
      const result = await api.recheck(id);
      if (result.kind === 'failed') {
        patch(id, { busy: null, problem: result.error.message });
        await load();
        return;
      }
      const usage = await fetchUsage(id);
      loads++;
      patch(id, { busy: null, info: { kind: 'loaded', value: result.value.info }, usage });
    },
    setConfig: async (id, config) => {
      patch(id, { busy: 'saving', problem: null });
      const result = await api.setPluginConfig(id, config);
      if (result.kind === 'failed') patch(id, { busy: null, problem: result.error.message });
      else await reloadOne(result.value, null);
    },
    setEnabled: async (id, enabled) => {
      patch(id, { busy: 'saving', problem: null });
      const result = await api.setPluginEnabled(id, enabled);
      if (result.kind === 'failed') patch(id, { busy: null, problem: result.error.message });
      else await reloadOne(result.value, null);
    },
    release: async (id, regId) => {
      patch(id, { busy: 'releasing', problem: null });
      const result = await api.releaseGroup(regId);
      patch(id, { busy: null, problem: result.kind === 'failed' ? result.error.message : null });
      await load();
      options.onReleased?.();
    },
    close: () => {
      closed = true;
      clearTimeout(blockedTimer);
      stopEvents();
      stopRestarts();
    },
  };
}
