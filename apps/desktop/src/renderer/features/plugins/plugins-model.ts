import type { PluginConfig, PluginEntry, PluginList } from '@morrowbot/contracts';
import type { MorrowbotBridge } from '../../bridge.ts';
import type { Api } from '../../shared/api.ts';
import { Store, type Loadable } from '../../shared/store.ts';

export type PluginWork = 'saving' | 'restarting';

/** What the user started on each plugin and why it did not work, by plugin id; and Rescan's own state. */
export interface PluginActivity {
  readonly busy: Readonly<Record<string, PluginWork>>;
  readonly problems: Readonly<Record<string, string>>;
  readonly rescan: { readonly kind: 'idle' } | { readonly kind: 'running' } | { readonly kind: 'failed'; readonly message: string };
}

/** Extensions' copy of the host's plugin list (spec IA §3): every plugin, safe mode, the plugins folder and discovery problems. */
export interface PluginsModel {
  readonly list: Store<Loadable<PluginList>>;
  readonly activity: Store<PluginActivity>;
  load(): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  setConfig(id: string, config: PluginConfig): Promise<boolean>;
  restart(id: string): Promise<void>;
  rescan(): Promise<void>;
  close(): void;
}

export interface PluginsModelOptions {
  readonly api: Api;
  readonly bridge: Pick<MorrowbotBridge, 'onHostReady'>;
  readonly startingRefreshMs?: number;
  /** After a change to a plugin, which Providers also shows for community providers. */
  readonly onChanged?: () => void;
}

const IDLE: PluginActivity = { busy: {}, problems: {}, rescan: { kind: 'idle' } };
const without = <T>(record: Readonly<Record<string, T>>, id: string): Readonly<Record<string, T>> => Object.fromEntries(Object.entries(record).filter(([key]) => key !== id));

export function createPluginsModel(options: PluginsModelOptions): PluginsModel {
  const { api } = options;
  const list = new Store<Loadable<PluginList>>({ kind: 'loading' });
  const activity = new Store<PluginActivity>(IDLE);
  let loads = 0;
  let closed = false;
  let startingTimer: ReturnType<typeof setTimeout> | undefined;

  const begin = (id: string, work: PluginWork): void => {
    activity.update((now) => ({ ...now, busy: { ...now.busy, [id]: work }, problems: without(now.problems, id) }));
  };
  const finish = (id: string, problem: string | null): void => {
    activity.update((now) => ({ ...now, busy: without(now.busy, id), problems: problem === null ? without(now.problems, id) : { ...now.problems, [id]: problem } }));
  };

  /** A plugin that is still starting reports running or a failure shortly: look again until none is starting. */
  function watchStarting(value: PluginList): void {
    clearTimeout(startingTimer);
    if (value.plugins.some(({ enabled, status }) => enabled && status.kind === 'starting')) {
      startingTimer = setTimeout(() => void load(), options.startingRefreshMs ?? 2_000);
    }
  }

  function show(value: PluginList): void {
    list.set({ kind: 'loaded', value });
    watchStarting(value);
  }

  async function load(): Promise<void> {
    const mine = ++loads;
    const result = await api.listPlugins();
    if (mine !== loads || closed) return;
    if (result.kind === 'failed') list.set({ kind: 'failed', message: result.error.message });
    else show(result.value);
  }

  /** Puts one changed entry into the list, then tells Providers. */
  function replace(entry: PluginEntry): void {
    loads += 1;
    list.update((now) => (now.kind === 'loaded' ? { kind: 'loaded', value: { ...now.value, plugins: now.value.plugins.map((each) => (each.manifest.id === entry.manifest.id ? entry : each)) } } : now));
    const now = list.get();
    if (now.kind === 'loaded') watchStarting(now.value);
    options.onChanged?.();
  }

  async function change(id: string, work: PluginWork, call: () => ReturnType<Api['setPluginEnabled']>): Promise<boolean> {
    begin(id, work);
    const result = await call();
    if (result.kind === 'failed') {
      finish(id, result.error.message);
      return false;
    }
    replace(result.value);
    finish(id, null);
    return true;
  }

  const stopRestarts = options.bridge.onHostReady(() => void load());

  return {
    list,
    activity,
    load,
    setEnabled: async (id, enabled) => {
      await change(id, 'saving', () => api.setPluginEnabled(id, enabled));
    },
    setConfig: (id, config) => change(id, 'saving', () => api.setPluginConfig(id, config)),
    restart: async (id) => {
      await change(id, 'restarting', () => api.restartPlugin(id));
    },
    rescan: async () => {
      activity.update((now) => ({ ...now, rescan: { kind: 'running' } }));
      loads += 1;
      const result = await api.rescanPlugins();
      if (closed) return;
      if (result.kind === 'failed') {
        activity.update((now) => ({ ...now, rescan: { kind: 'failed', message: result.error.message } }));
        return;
      }
      show(result.value);
      activity.update((now) => ({ ...now, rescan: { kind: 'idle' } }));
      options.onChanged?.();
    },
    close: () => {
      closed = true;
      clearTimeout(startingTimer);
      stopRestarts();
    },
  };
}
