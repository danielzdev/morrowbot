import type { Agent, CreateAgentRequest, Thread, UpdateAgentRequest } from '@morrowbot/contracts';
import type { z } from 'zod';
import type { MorrowbotBridge } from '../../bridge.ts';
import type { Api, ApiResult } from '../../shared/api.ts';
import { Store, type Loadable } from '../../shared/store.ts';

export interface AgentsState {
  readonly agents: Loadable<readonly Agent[]>;
  readonly selectedAgentId: string | null;
  /** Each agent's chats, newest first. */
  readonly threads: Readonly<Record<string, Loadable<readonly Thread[]>>>;
  /** The open chat tab of each agent. */
  readonly openThread: Readonly<Record<string, string>>;
  readonly problem: string | null;
}

export type Saved<T> = { readonly kind: 'saved'; readonly value: T } | { readonly kind: 'refused'; readonly message: string };

export interface AgentsModel {
  readonly state: Store<AgentsState>;
  load(): Promise<void>;
  selectAgent(id: string): void;
  createAgent(request: z.input<typeof CreateAgentRequest>): Promise<Saved<Agent>>;
  updateAgent(id: string, request: UpdateAgentRequest): Promise<Saved<Agent>>;
  deleteAgent(id: string): Promise<void>;
  newThread(agentId: string): Promise<void>;
  openThread(agentId: string, threadId: string): void;
  renameThread(agentId: string, threadId: string, title: string): Promise<void>;
  deleteThread(agentId: string, threadId: string): Promise<void>;
  /** Moves the chat to the front after activity, and names an untitled chat after its first message. */
  touchThread(agentId: string, threadId: string, firstText: string | null): Promise<void>;
  instructions(id: string): Promise<Saved<string>>;
  saveInstructions(id: string, content: string): Promise<Saved<string>>;
  dismissProblem(): void;
  close(): void;
}

const UNTITLED = 'New chat';
const byNewest = (threads: readonly Thread[]): readonly Thread[] => [...threads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

function saved<T, U>(result: ApiResult<T>, pick: (value: T) => U): Saved<U> {
  return result.kind === 'ok' ? { kind: 'saved', value: pick(result.value) } : { kind: 'refused', message: result.error.message };
}

const updateKey = (id: string, request: UpdateAgentRequest): string =>
  [id, request.name !== undefined, request.description !== undefined, request.avatar !== undefined, request.provider !== undefined].join('|');

/** The agent as `request` asks for it. */
const applied = (agent: Agent, request: UpdateAgentRequest): Agent => ({
  ...agent,
  name: request.name ?? agent.name,
  description: request.description ?? agent.description,
  avatar: request.avatar ?? agent.avatar,
  provider: request.provider ?? agent.provider,
});

/** `agent` with the fields `request` names taken from `source`; other fields, maybe still saving, stay. */
const withFields = (agent: Agent, request: UpdateAgentRequest, source: Agent): Agent => ({
  ...agent,
  name: request.name === undefined ? agent.name : source.name,
  description: request.description === undefined ? agent.description : source.description,
  avatar: request.avatar === undefined ? agent.avatar : source.avatar,
  provider: request.provider === undefined ? agent.provider : source.provider,
});

export function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0]?.trim() ?? '';
  return line.length <= 48 ? line : `${line.slice(0, 47)}…`;
}

export interface AgentsModelOptions {
  readonly api: Api;
  readonly bridge: Pick<MorrowbotBridge, 'onHostReady'>;
  /** Chats that no longer exist, so their open sessions can stop following them. */
  readonly onThreadsDeleted?: (threadIds: readonly string[]) => void;
}

export function createAgentsModel(options: AgentsModelOptions): AgentsModel {
  const { api } = options;
  let loads = 0;
  let threadSeq = 0;
  /** The latest thread-list request per agent; a reply to an older one, or one sent before a full load, is dropped. */
  const threadLoads = new Map<string, number>();
  /**
   * Updates show at once. Updates of the same fields of an agent go to the host one at a time, in
   * order; only the last one's reply is shown, and a refused one shows what the host kept.
   */
  const updates = new Map<string, Promise<unknown>>();
  const state = new Store<AgentsState>({ agents: { kind: 'loading' }, selectedAgentId: null, threads: {}, openThread: {}, problem: null });
  const patch = (change: Partial<AgentsState>): void => {
    state.update((current) => ({ ...current, ...change }));
  };
  const setThreads = (agentId: string, threads: Loadable<readonly Thread[]>): void => {
    state.update((current) => ({ ...current, threads: { ...current.threads, [agentId]: threads } }));
  };
  const setOpen = (agentId: string, threadId: string | undefined): void => {
    state.update((current) => {
      const others = Object.fromEntries(Object.entries(current.openThread).filter(([key]) => key !== agentId));
      return { ...current, openThread: threadId === undefined ? others : { ...others, [agentId]: threadId } };
    });
  };
  const threadsOf = (agentId: string): readonly Thread[] => {
    const threads = state.get().threads[agentId];
    return threads?.kind === 'loaded' ? threads.value : [];
  };

  async function loadThreads(agentId: string): Promise<void> {
    const mine = ++threadSeq;
    threadLoads.set(agentId, mine);
    const result = await api.listThreads(agentId);
    if (threadLoads.get(agentId) !== mine) return;
    if (result.kind === 'failed') {
      setThreads(agentId, { kind: 'failed', message: result.error.message });
      return;
    }
    const threads = byNewest(result.value.threads);
    setThreads(agentId, { kind: 'loaded', value: threads });
    const open = state.get().openThread[agentId];
    if (open === undefined || !threads.some(({ id }) => id === open)) setOpen(agentId, threads[0]?.id);
  }

  function selectAgent(id: string): void {
    patch({ selectedAgentId: id });
    if (state.get().threads[id]?.kind !== 'loaded') void loadThreads(id);
  }

  async function load(): Promise<void> {
    const mine = ++loads;
    threadLoads.clear();
    const result = await api.listAgents();
    if (mine !== loads) return;
    if (result.kind === 'failed') {
      patch({ agents: { kind: 'failed', message: result.error.message } });
      return;
    }
    const agents = result.value.agents;
    const selected = state.get().selectedAgentId;
    patch({ agents: { kind: 'loaded', value: agents }, threads: {} });
    const keep = agents.find(({ id }) => id === selected) ?? agents[0];
    if (keep === undefined) patch({ selectedAgentId: null });
    else selectAgent(keep.id);
  }

  const agentOf = (id: string): Agent | undefined => {
    const agents = state.get().agents;
    return agents.kind === 'loaded' ? agents.value.find((each) => each.id === id) : undefined;
  };
  /** Replaces an agent the list still has; an agent deleted meanwhile stays gone. */
  const changeAgent = (agent: Agent): void => {
    if (agentOf(agent.id) !== undefined) replaceAgent(agent);
  };
  async function hostAgent(id: string): Promise<Agent | undefined> {
    const result = await api.listAgents();
    return result.kind === 'ok' ? result.value.agents.find((each) => each.id === id) : undefined;
  }

  const replaceAgent = (agent: Agent): void => {
    const current = state.get().agents;
    if (current.kind !== 'loaded') return;
    const exists = current.value.some(({ id }) => id === agent.id);
    patch({ agents: { kind: 'loaded', value: exists ? current.value.map((each) => (each.id === agent.id ? agent : each)) : [...current.value, agent] } });
  };

  async function newThread(agentId: string): Promise<void> {
    const result = await api.createThread(agentId);
    if (result.kind === 'failed') {
      patch({ problem: result.error.message });
      return;
    }
    threadLoads.set(agentId, ++threadSeq);
    setThreads(agentId, { kind: 'loaded', value: [result.value, ...threadsOf(agentId)] });
    setOpen(agentId, result.value.id);
  }

  const stopRestarts = options.bridge.onHostReady(() => void load());

  return {
    state,
    load,
    selectAgent,
    createAgent: async (request) => {
      const result = await api.createAgent(request);
      if (result.kind === 'ok') {
        replaceAgent(result.value);
        selectAgent(result.value.id);
      }
      return saved(result, (agent) => agent);
    },
    updateAgent: (id, request) => {
      const key = updateKey(id, request);
      const before = agentOf(id);
      if (before !== undefined) changeAgent(withFields(before, request, applied(before, request)));
      const run = async (): Promise<Saved<Agent>> => {
        const result = await api.updateAgent(id, request);
        if (updates.get(key) === next) {
          const host = result.kind === 'ok' ? result.value : await hostAgent(id);
          const now = agentOf(id);
          if (host !== undefined && now !== undefined) changeAgent(withFields(now, request, host));
        }
        return saved(result, (agent) => agent);
      };
      const next = (updates.get(key) ?? Promise.resolve()).then(run, run);
      updates.set(key, next);
      const clear = (): void => {
        if (updates.get(key) === next) updates.delete(key);
      };
      void next.then(clear, clear);
      return next;
    },
    deleteAgent: async (id) => {
      const open = state.get().openThread[id];
      const threadIds = [...threadsOf(id).map((thread) => thread.id), ...(open === undefined ? [] : [open])];
      const result = await api.deleteAgent(id);
      if (result.kind === 'failed') {
        patch({ problem: result.error.message });
        return;
      }
      setOpen(id, undefined);
      options.onThreadsDeleted?.(threadIds);
      await load();
    },
    newThread,
    openThread: setOpen,
    renameThread: async (agentId, threadId, title) => {
      const result = await api.renameThread(threadId, title);
      if (result.kind === 'failed') patch({ problem: result.error.message });
      else setThreads(agentId, { kind: 'loaded', value: threadsOf(agentId).map((each) => (each.id === threadId ? result.value : each)) });
    },
    deleteThread: async (agentId, threadId) => {
      const result = await api.deleteThread(threadId);
      if (result.kind === 'failed') {
        patch({ problem: result.error.message });
        return;
      }
      const remaining = threadsOf(agentId).filter(({ id }) => id !== threadId);
      setThreads(agentId, { kind: 'loaded', value: remaining });
      if (state.get().openThread[agentId] === threadId) setOpen(agentId, remaining[0]?.id);
      options.onThreadsDeleted?.([threadId]);
      await loadThreads(agentId);
    },
    touchThread: async (agentId, threadId, firstText) => {
      const thread = threadsOf(agentId).find(({ id }) => id === threadId);
      const title = firstText === null ? '' : titleFrom(firstText);
      if (thread?.title === UNTITLED && title !== '') {
        const result = await api.renameThread(threadId, title);
        if (result.kind === 'ok') {
          setThreads(agentId, { kind: 'loaded', value: byNewest(threadsOf(agentId).map((each) => (each.id === threadId ? result.value : each))) });
          return;
        }
      }
      await loadThreads(agentId);
    },
    instructions: async (id) => saved(await api.instructions(id), ({ content }) => content),
    saveInstructions: async (id, content) => saved(await api.saveInstructions(id, content), (value) => value.content),
    dismissProblem: () => {
      patch({ problem: null });
    },
    close: stopRestarts,
  };
}
