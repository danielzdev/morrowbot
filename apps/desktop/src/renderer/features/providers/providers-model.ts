import type { EventServerFrame, PluginConfig, PluginEntry, ProviderInfo, UsageResponse } from '@morrowbot/contracts';
import type { MorrowbotBridge } from '../../bridge.ts';
import type { Api } from '../../shared/api.ts';
import { Store, type Loadable } from '../../shared/store.ts';

/** When the provider's status was last read: a plain fetch says "Status loaded", a Recheck says "Checked" (spec §6.2). */
export interface StatusAge {
  readonly via: 'load' | 'recheck';
  readonly at: string;
}

export interface ProviderCard {
  readonly entry: PluginEntry;
  readonly info: Loadable<ProviderInfo>;
  readonly usage: UsageResponse | null;
  readonly busy: 'rechecking' | 'saving' | 'releasing' | null;
  /** Why the last action on this provider did not work, in the host's words. */
  readonly problem: string | null;
  readonly age: StatusAge | null;
}

/** The AI engines: built-in providers and community ones from plugins (spec §0.1). The renderer reaches providers only here. */
export interface ProvidersModel {
  readonly cards: Store<Loadable<readonly ProviderCard[]>>;
  /** This launch is in safe mode: community providers are off, built-in ones still run. */
  readonly safeMode: Store<{ readonly on: boolean }>;
  load(): Promise<void>;
  refreshInfo(id: string): Promise<void>;
  recheck(id: string): Promise<void>;
  /** Asks the provider for its plan limits again, past the host's cache. */
  refreshUsage(id: string): Promise<void>;
  setConfig(id: string, config: PluginConfig): Promise<boolean>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  release(id: string, regId: string): Promise<void>;
  close(): void;
}

export interface ProvidersModelOptions {
  readonly api: Api;
  readonly bridge: Pick<MorrowbotBridge, 'onEvent' | 'onHostReady'>;
  readonly blockedRefreshMs?: number;
  readonly now?: () => string;
  /** After a Release, which can free chats that other screens show. */
  readonly onReleased?: () => void;
  /** After a change to a provider's switch or settings, which Extensions also shows for community providers. */
  readonly onChanged?: () => void;
}

const isRunning = (entry: PluginEntry): boolean => entry.enabled && entry.status.kind === 'running';

export function createProvidersModel(options: ProvidersModelOptions): ProvidersModel {
  const { api } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const cards = new Store<Loadable<readonly ProviderCard[]>>({ kind: 'loading' });
  const safeMode = new Store({ on: false });
  let blockedTimer: ReturnType<typeof setTimeout> | undefined;
  let loads = 0;
  let closed = false;
  /** Bumped when one card is replaced, so a list load that started earlier keeps that card. */
  const versions = new Map<string, number>();
  const bump = (id: string): void => {
    versions.set(id, (versions.get(id) ?? 0) + 1);
  };

  const card = (id: string): ProviderCard | undefined => {
    const current = cards.get();
    return current.kind === 'loaded' ? current.value.find(({ entry }) => entry.manifest.id === id) : undefined;
  };
  const patch = (id: string, change: Partial<ProviderCard>): void => {
    cards.update((current) =>
      current.kind === 'loaded'
        ? { kind: 'loaded', value: current.value.map((each) => (each.entry.manifest.id === id ? { ...each, ...change } : each)) }
        : current,
    );
  };

  async function fetchInfo(id: string, refresh: boolean): Promise<Pick<ProviderCard, 'info' | 'age'>> {
    const result = await api.providerInfo(id, refresh);
    return result.kind === 'ok' ? { info: { kind: 'loaded', value: result.value.info }, age: { via: 'load', at: now() } } : { info: { kind: 'failed', message: result.error.message }, age: null };
  }

  async function fetchUsage(id: string, refresh = false): Promise<UsageResponse | null> {
    const result = await api.usage(id, refresh);
    return result.kind === 'ok' ? result.value : null;
  }

  /** A card's entry, info and usage as the host has them now; `busy` and `problem` belong to the caller. */
  async function fetchCard(entry: PluginEntry): Promise<Omit<ProviderCard, 'busy' | 'problem'>> {
    if (!isRunning(entry)) return { entry, info: { kind: 'failed', message: 'The provider is not running.' }, usage: null, age: null };
    const [info, usage] = await Promise.all([fetchInfo(entry.manifest.id, false), fetchUsage(entry.manifest.id)]);
    return { entry, ...info, usage };
  }

  function watchBlocked(list: readonly ProviderCard[]): void {
    clearTimeout(blockedTimer);
    if (list.some(({ entry }) => entry.blockedGroups.length > 0 || (entry.enabled && entry.status.kind === 'starting'))) {
      blockedTimer = setTimeout(() => void load(), options.blockedRefreshMs ?? 5_000);
    }
  }

  async function load(): Promise<void> {
    const mine = ++loads;
    const started = new Map(versions);
    const result = await api.listPlugins();
    const fetched = result.kind === 'ok' ? await Promise.all(result.value.plugins.filter((entry) => entry.manifest.kind === 'provider').map(fetchCard)) : [];
    if (mine !== loads || closed) return;
    if (result.kind === 'failed') {
      cards.set({ kind: 'failed', message: result.error.message });
      return;
    }
    if (safeMode.get().on !== result.value.safeMode) safeMode.set({ on: result.value.safeMode });
    const list = fetched.map((next): ProviderCard => {
      const id = next.entry.manifest.id;
      const live = card(id);
      if (live !== undefined && versions.get(id) !== started.get(id)) return live;
      return { ...next, busy: live?.busy ?? null, problem: live?.problem ?? null };
    });
    cards.set({ kind: 'loaded', value: list });
    watchBlocked(list);
  }

  /** Replaces one provider's entry after a change, and fetches its info again. */
  async function reloadOne(entry: PluginEntry): Promise<void> {
    const next = await fetchCard(entry);
    bump(entry.manifest.id);
    patch(entry.manifest.id, { ...next, busy: null, problem: null });
    options.onChanged?.();
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
    safeMode,
    load,
    refreshInfo: async (id) => {
      patch(id, await fetchInfo(id, false));
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
      bump(id);
      patch(id, { busy: null, info: { kind: 'loaded', value: result.value.info }, usage, age: { via: 'recheck', at: now() } });
    },
    refreshUsage: async (id) => {
      const usage = await fetchUsage(id, true);
      patch(id, { usage });
    },
    setConfig: async (id, config) => {
      patch(id, { busy: 'saving', problem: null });
      const result = await api.setPluginConfig(id, config);
      if (result.kind === 'failed') {
        patch(id, { busy: null, problem: result.error.message });
        return false;
      }
      await reloadOne(result.value);
      return true;
    },
    setEnabled: async (id, enabled) => {
      patch(id, { busy: 'saving', problem: null });
      const result = await api.setPluginEnabled(id, enabled);
      if (result.kind === 'failed') patch(id, { busy: null, problem: result.error.message });
      else await reloadOne(result.value);
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
