import { mainThread, type Agent, type PluginEntry, type ProviderInfo, type Thread, type UpdateAgentRequest } from '@morrowbot/contracts';
import type { ChatHost, ChatResult } from '../../lib/chat-host.ts';
import { openChatSession, type ChatSession } from './chat-session.ts';
import { Store, type Loadable } from './store.ts';

/** Shared by every chat screen of one host: agents, their threads, plugins and provider models, plus open sessions. */
export interface ChatHub {
  readonly host: ChatHost;
  readonly agents: Store<Loadable<readonly Agent[]>>;
  readonly plugins: Store<Loadable<readonly PluginEntry[]>>;
  threads(agentId: string): Store<Loadable<readonly Thread[]>>;
  /** The provider's models and status; `''` (an agent with no provider) is never asked for. */
  providerInfo(pluginId: string): Store<Loadable<ProviderInfo>>;
  /** The open chat of `threadId`, kept across tab switches so its draft survives. */
  session(threadId: string): ChatSession;
  /** Loads agents, plugins and every thread list shown so far again, as when the link comes back. */
  refresh(): void;
  refreshAgents(): Promise<void>;
  refreshThreads(agentId: string): Promise<void>;
  refreshPlugins(): Promise<void>;
  updateAgent(agentId: string, request: UpdateAgentRequest): Promise<ChatResult<Agent>>;
  createThread(agentId: string): Promise<ChatResult<Thread>>;
  setPluginEnabled(pluginId: string, enabled: boolean): Promise<ChatResult<PluginEntry>>;
}

const loadable = <T>(result: ChatResult<T>): Loadable<T> =>
  result.kind === 'ok' ? { kind: 'loaded', value: result.value } : { kind: 'failed', message: result.error.message };

/** The thread a chat route means: its own, or the agent's main chat for `null`. */
export function threadFor(threads: readonly Thread[], threadId: string | null): Thread | null {
  return threadId === null ? mainThread(threads) : (threads.find(({ id }) => id === threadId) ?? null);
}

export function createChatHub(host: ChatHost): ChatHub {
  const agents = new Store<Loadable<readonly Agent[]>>({ kind: 'loading' });
  const plugins = new Store<Loadable<readonly PluginEntry[]>>({ kind: 'loading' });
  const threads = new Map<string, Store<Loadable<readonly Thread[]>>>();
  const infos = new Map<string, Store<Loadable<ProviderInfo>>>();
  const sessions = new Map<string, ChatSession>();

  const refreshAgents = async (): Promise<void> => {
    const result = await host.agents();
    agents.set(result.kind === 'ok' ? { kind: 'loaded', value: result.value.agents } : loadable(result));
  };
  const refreshPlugins = async (): Promise<void> => {
    const result = await host.plugins();
    plugins.set(result.kind === 'ok' ? { kind: 'loaded', value: result.value.plugins } : loadable(result));
  };
  const threadStore = (agentId: string): Store<Loadable<readonly Thread[]>> => {
    const existing = threads.get(agentId);
    if (existing !== undefined) return existing;
    const store = new Store<Loadable<readonly Thread[]>>({ kind: 'loading' });
    threads.set(agentId, store);
    void refreshThreads(agentId);
    return store;
  };
  async function refreshThreads(agentId: string): Promise<void> {
    const result = await host.threads(agentId);
    threadStore(agentId).set(result.kind === 'ok' ? { kind: 'loaded', value: result.value.threads } : loadable(result));
  }
  host.onPluginChanged((entry) => {
    plugins.update((current) =>
      current.kind === 'loaded'
        ? { kind: 'loaded', value: current.value.map((each) => (each.manifest.id === entry.manifest.id ? entry : each)) }
        : current,
    );
  });

  return {
    host,
    agents,
    plugins,
    threads: threadStore,
    providerInfo: (pluginId) => {
      const existing = infos.get(pluginId);
      if (existing !== undefined) return existing;
      const store = new Store<Loadable<ProviderInfo>>(pluginId === '' ? { kind: 'failed', message: 'No provider' } : { kind: 'loading' });
      infos.set(pluginId, store);
      if (pluginId === '') return store;
      void host.providerInfo(pluginId).then((result) => {
        store.set(result.kind === 'ok' ? { kind: 'loaded', value: result.value.info } : loadable(result));
      });
      return store;
    },
    session: (threadId) => {
      const existing = sessions.get(threadId);
      if (existing !== undefined) return existing;
      const session = openChatSession(host, threadId);
      sessions.set(threadId, session);
      session.load();
      return session;
    },
    refresh: () => {
      void refreshAgents();
      void refreshPlugins();
      for (const agentId of threads.keys()) void refreshThreads(agentId);
    },
    refreshAgents,
    refreshThreads,
    refreshPlugins,
    updateAgent: async (agentId, request) => {
      const result = await host.updateAgent(agentId, request);
      if (result.kind === 'ok') {
        agents.update((current) =>
          current.kind === 'loaded' ? { kind: 'loaded', value: current.value.map((agent) => (agent.id === agentId ? result.value : agent)) } : current,
        );
      }
      return result;
    },
    createThread: async (agentId) => {
      const result = await host.createThread(agentId);
      if (result.kind === 'ok') await refreshThreads(agentId);
      return result;
    },
    setPluginEnabled: (pluginId, enabled) => host.setPluginEnabled(pluginId, enabled),
  };
}
