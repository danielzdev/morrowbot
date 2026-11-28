import { mainThread, withAgentExtension, type Agent, type PluginEntry, type ProviderInfo, type Thread, type UpdateAgentRequest } from '@morrowbot/contracts';
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
  /** Enables or disables one tool plugin for `agent` at its current `revision`. */
  setAgentExtension(agent: Agent, pluginId: string, enabled: boolean): Promise<ChatResult<Agent>>;
  /** Adopts a newer agent record reported by an `agent-conflict` across all host consumers. */
  adoptAgent(agent: Agent): void;
  createThread(agentId: string): Promise<ChatResult<Thread>>;
  setPluginEnabled(pluginId: string, enabled: boolean): Promise<ChatResult<PluginEntry>>;
  /** Unsubscribes from host change listeners when this hub is replaced. */
  dispose(): void;
}

const loadable = <T>(result: ChatResult<T>): Loadable<T> =>
  result.kind === 'ok' ? { kind: 'loaded', value: result.value } : { kind: 'failed', message: result.error.message };

/** Merges a fresh agent list monotonically, keeping newer cached revisions and omitting locally deleted agents. */
export function mergeAgents(
  current: Loadable<readonly Agent[]>,
  incoming: readonly Agent[],
  known: ReadonlyMap<string, Agent>,
  deleted: ReadonlySet<string>,
): readonly Agent[] {
  const cached = new Map<string, Agent>(known);
  if (current.kind === 'loaded') {
    for (const agent of current.value) {
      const prior = cached.get(agent.id);
      if (prior === undefined || agent.revision >= prior.revision) cached.set(agent.id, agent);
    }
  }
  return incoming
    .filter((agent) => !deleted.has(agent.id))
    .map((agent) => {
      const existing = cached.get(agent.id);
      return existing !== undefined && existing.revision > agent.revision ? existing : agent;
    });
}

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
  const knownAgents = new Map<string, Agent>();
  const deletedAgents = new Set<string>();
  let agentsSeq = 0;
  let pluginsSeq = 0;
  let disposed = false;

  const refreshAgents = async (): Promise<void> => {
    const mine = ++agentsSeq;
    const result = await host.agents();
    if (disposed || mine !== agentsSeq) return;
    agents.update((current) =>
      result.kind === 'ok' ? { kind: 'loaded', value: mergeAgents(current, result.value.agents, knownAgents, deletedAgents) } : loadable(result),
    );
  };
  const refreshPlugins = async (): Promise<void> => {
    const mine = ++pluginsSeq;
    const result = await host.plugins();
    if (disposed || mine !== pluginsSeq) return;
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
    if (disposed) return;
    threadStore(agentId).set(result.kind === 'ok' ? { kind: 'loaded', value: result.value.threads } : loadable(result));
  }
  const replaceAgent = (updated: Agent): void => {
    deletedAgents.delete(updated.id);
    const prior = knownAgents.get(updated.id);
    if (prior === undefined || updated.revision >= prior.revision) knownAgents.set(updated.id, updated);
    agents.update((current) =>
      current.kind === 'loaded'
        ? {
            kind: 'loaded',
            value: current.value.map((each) => (each.id === updated.id && updated.revision >= each.revision ? updated : each)),
          }
        : current,
    );
  };
  const stopAgentChanged = host.onAgentChanged(replaceAgent);
  const stopAgentDeleted = host.onAgentDeleted((agentId) => {
    deletedAgents.add(agentId);
    knownAgents.delete(agentId);
    agents.update((current) =>
      current.kind === 'loaded' ? { kind: 'loaded', value: current.value.filter((each) => each.id !== agentId) } : current,
    );
  });
  const stopPluginChanged = host.onPluginChanged((entry) => {
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
        if (disposed) return;
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
      if (result.kind === 'ok') replaceAgent(result.value);
      return result;
    },
    setAgentExtension: async (agent, pluginId, enabled) => {
      const result = await host.updateAgent(agent.id, {
        disabledExtensions: withAgentExtension(agent.disabledExtensions, pluginId, enabled),
        revision: agent.revision,
      });
      if (result.kind === 'ok') replaceAgent(result.value);
      return result;
    },
    adoptAgent: (agent) => {
      host.adoptAgent(agent);
    },
    createThread: async (agentId) => {
      const result = await host.createThread(agentId);
      if (result.kind === 'ok') await refreshThreads(agentId);
      return result;
    },
    setPluginEnabled: (pluginId, enabled) => host.setPluginEnabled(pluginId, enabled),
    dispose: () => {
      disposed = true;
      stopAgentChanged();
      stopAgentDeleted();
      stopPluginChanged();
    },
  };
}
