import { mainThread, type Agent, type CreateAgentRequest, type Folder, type LastMessage, type SkillList, type Thread, type UpdateAgentRequest } from '@morrowbot/contracts';
import type { z } from 'zod';
import type { MorrowbotBridge } from '../../bridge.ts';
import type { Api } from '../../shared/api.ts';
import { Store, type Loadable } from '../../shared/store.ts';
import { applied, byNewest, clearDeletedFolder, createExtensionOps, lastByAgent, mergeMonotonicAgents, saved, titleFrom, UNTITLED, updateKey, withFields, type AgentExtensionSaved, type Saved } from './agents-helpers.ts';
import { createInstructionsEditor, type InstructionsEditor } from './instructions-editor.ts';
import { createMemoriesEditor, loadSkills, type MemoriesEditor } from './memories-editor.ts';

export { titleFrom, type AgentExtensionSaved, type Saved } from './agents-helpers.ts';

export interface AgentsState {
  readonly agents: Loadable<readonly Agent[]>;
  /** The person's folders, in the order they made them. */
  readonly folders: readonly Folder[];
  /** Each agent's newest message across its chats, by agent id. */
  readonly lastMessages: Readonly<Record<string, LastMessage>>;
  readonly selectedAgentId: string | null;
  /** Each agent's active chats, newest first. */
  readonly threads: Readonly<Record<string, Loadable<readonly Thread[]>>>;
  /** Each agent's archived chats, most recently archived first. */
  readonly archivedThreads: Readonly<Record<string, Loadable<readonly Thread[]>>>;
  /** The open chat of each agent. */
  readonly openThread: Readonly<Record<string, string>>;
  /** Chats whose turn finished while they were not on screen, by chat id, with their agent's id. */
  readonly unread: Readonly<Record<string, string>>;
  /** Agent ids whose per-agent extension write is currently in flight. */
  readonly savingExtensions: readonly string[];
  readonly problem: string | null;
}

export interface AgentsModel {
  readonly state: Store<AgentsState>;
  load(): Promise<void>;
  selectAgent(id: string): void;
  createAgent(request: z.input<typeof CreateAgentRequest>): Promise<Saved<Agent>>;
  updateAgent(id: string, request: UpdateAgentRequest): Promise<Saved<Agent>>;
  /** Updates per-agent disabled extensions at `revision`; returns `conflict` with the newer agent when stale. */
  setExtensions(id: string, disabledExtensions: readonly string[], revision: number): Promise<AgentExtensionSaved>;
  /** Adopts a newer agent record reported by a conflict without writing anything. */
  adoptAgent(agent: Agent): void;
  deleteAgent(id: string): Promise<void>;
  createFolder(name: string): Promise<Saved<Folder>>;
  renameFolder(id: string, name: string): Promise<void>;
  /** Deletes the folder; its agents stay, in no folder. */
  deleteFolder(id: string): Promise<void>;
  newThread(agentId: string): Promise<void>;
  /** Fetches the agent's chats again, such as after a routine posted in a new one. */
  reloadThreads(agentId: string): Promise<void>;
  /** Loads the agent's archived chats, most recently archived first. */
  loadArchivedThreads(agentId: string): Promise<void>;
  openThread(agentId: string, threadId: string): void;
  renameThread(agentId: string, threadId: string, title: string): Promise<void>;
  archiveThread(agentId: string, threadId: string): Promise<void>;
  restoreThread(agentId: string, threadId: string): Promise<void>;
  deleteThread(agentId: string, threadId: string): Promise<void>;
  /** A turn finished in this chat; it counts as unread unless it is the chat on screen. */
  markFinished(agentId: string, threadId: string): void;
  /** Moves the chat to the front after activity, and names an untitled chat after its first message. */
  touchThread(agentId: string, threadId: string, firstText: string | null): Promise<void>;
  /** The SOUL.md editor of one agent; each call starts a fresh one. */
  instructionsEditor(agentId: string): InstructionsEditor;
  /** The memories editor of one agent; each call starts a fresh one. */
  memoriesEditor(agentId: string): MemoriesEditor;
  skills(agentId: string): Promise<Loadable<SkillList>>;
  dismissProblem(): void;
  close(): void;
}

export interface AgentsModelOptions {
  readonly api: Api;
  readonly bridge: Pick<MorrowbotBridge, 'onHostReady'>;
  /** Chats that no longer exist, so their open sessions and drafts can be removed. */
  readonly onThreadsDeleted?: (threadIds: readonly string[]) => void;
  /** Chats that were archived, so their live sessions and activity badges can detach. */
  readonly onThreadsArchived?: (threadIds: readonly string[]) => void;
}

export function createAgentsModel(options: AgentsModelOptions): AgentsModel {
  const { api } = options;
  let loads = 0;
  let threadSeq = 0;
  /** The latest thread-list request per agent; a reply to an older one, or one sent before a full load, is dropped. */
  const threadLoads = new Map<string, number>();
  const archivedLoads = new Map<string, number>();
  /**
   * Updates show at once. Updates of the same fields of an agent go to the host one at a time, in
   * order; only the last one's reply is shown, and a refused one shows what the host kept.
   */
  const updates = new Map<string, Promise<unknown>>();
  const state = new Store<AgentsState>({ agents: { kind: 'loading' }, folders: [], lastMessages: {}, selectedAgentId: null, threads: {}, archivedThreads: {}, openThread: {}, unread: {}, savingExtensions: [], problem: null });
  let summaries = 0;
  const patch = (change: Partial<AgentsState>): void => {
    state.update((current) => ({ ...current, ...change }));
  };
  const setThreads = (agentId: string, threads: Loadable<readonly Thread[]>): void => {
    state.update((current) => ({ ...current, threads: { ...current.threads, [agentId]: threads } }));
  };
  const setArchived = (agentId: string, threads: Loadable<readonly Thread[]>): void => {
    state.update((current) => ({ ...current, archivedThreads: { ...current.archivedThreads, [agentId]: threads } }));
  };
  const setOpen = (agentId: string, threadId: string | undefined): void => {
    state.update((current) => {
      const others = Object.fromEntries(Object.entries(current.openThread).filter(([key]) => key !== agentId));
      const openThread = threadId === undefined ? others : { ...others, [agentId]: threadId };
      return { ...current, openThread, unread: seen(current.unread, current.selectedAgentId === agentId ? threadId : undefined) };
    });
  };
  /** The unread chats without the one now on screen. */
  const seen = (unread: AgentsState['unread'], threadId: string | undefined): AgentsState['unread'] =>
    threadId === undefined || !(threadId in unread) ? unread : Object.fromEntries(Object.entries(unread).filter(([key]) => key !== threadId));
  const threadsOf = (agentId: string): readonly Thread[] => {
    const threads = state.get().threads[agentId];
    return threads?.kind === 'loaded' ? threads.value : [];
  };
  const archivedOf = (agentId: string): readonly Thread[] => {
    const threads = state.get().archivedThreads[agentId];
    return threads?.kind === 'loaded' ? threads.value : [];
  };

  async function loadArchivedThreads(agentId: string): Promise<void> {
    const mine = ++threadSeq;
    archivedLoads.set(agentId, mine);
    if (state.get().archivedThreads[agentId] === undefined) setArchived(agentId, { kind: 'loading' });
    const result = await api.listArchivedThreads(agentId);
    if (archivedLoads.get(agentId) !== mine) return;
    setArchived(
      agentId,
      result.kind === 'failed'
        ? { kind: 'failed', message: result.error.message }
        : { kind: 'loaded', value: result.value.threads.filter((thread) => thread.archivedAt !== null) },
    );
  }

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
    if (open === undefined || !threads.some(({ id }) => id === open)) setOpen(agentId, mainThread(threads)?.id);
  }

  function selectAgent(id: string): void {
    state.update((current) => ({ ...current, selectedAgentId: id, unread: seen(current.unread, current.openThread[id]) }));
    if (state.get().threads[id]?.kind !== 'loaded') void loadThreads(id);
  }

  async function load(): Promise<void> {
    const mine = ++loads;
    threadLoads.clear();
    archivedLoads.clear();
    const result = await api.listAgents();
    if (mine !== loads) return;
    if (result.kind === 'failed') {
      patch({ agents: { kind: 'failed', message: result.error.message } });
      return;
    }
    const agents = mergeMonotonicAgents(state.get().agents, result.value.agents);
    const selected = state.get().selectedAgentId;
    summaries++;
    patch({ agents: { kind: 'loaded', value: agents }, folders: result.value.folders, lastMessages: lastByAgent(result.value), threads: {}, archivedThreads: {} });
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
    setOpen(agentId, result.value.id);
    if (state.get().threads[agentId]?.kind !== 'loaded') {
      await loadThreads(agentId);
      return;
    }
    threadLoads.set(agentId, ++threadSeq);
    setThreads(agentId, { kind: 'loaded', value: [result.value, ...threadsOf(agentId).filter(({ id }) => id !== result.value.id)] });
  }

  /** Refreshes last messages only, so agent and folder edits still saving are not undone. */
  async function refreshSummary(): Promise<void> {
    const mine = ++summaries;
    const result = await api.listAgents();
    if (mine === summaries && result.kind === 'ok') patch({ lastMessages: lastByAgent(result.value) });
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
    ...createExtensionOps({
      api,
      agentOf,
      changeAgent,
      hostAgent,
      setSaving: (id, saving) => {
        state.update((current) => ({
          ...current,
          savingExtensions: saving
            ? (current.savingExtensions.includes(id) ? current.savingExtensions : [...current.savingExtensions, id])
            : current.savingExtensions.filter((each) => each !== id),
        }));
      },
    }),
    deleteAgent: async (id) => {
      const open = state.get().openThread[id];
      const threadIds = [
        ...threadsOf(id).map((thread) => thread.id),
        ...archivedOf(id).map((thread) => thread.id),
        ...(open === undefined ? [] : [open]),
      ];
      const result = await api.deleteAgent(id);
      if (result.kind === 'failed') {
        patch({ problem: result.error.message });
        return;
      }
      setOpen(id, undefined);
      options.onThreadsDeleted?.(threadIds);
      await load();
    },
    createFolder: async (name) => {
      const result = await api.createFolder(name);
      if (result.kind === 'ok') patch({ folders: [...state.get().folders, result.value] });
      else patch({ problem: result.error.message });
      return saved(result, (folder) => folder);
    },
    renameFolder: async (id, name) => {
      const result = await api.renameFolder(id, name);
      if (result.kind === 'failed') {
        patch({ problem: result.error.message });
        return;
      }
      patch({ folders: state.get().folders.map((folder) => (folder.id === id ? result.value : folder)) });
    },
    deleteFolder: async (id) => {
      const result = await api.deleteFolder(id);
      if (result.kind === 'failed') {
        patch({ problem: result.error.message });
        return;
      }
      patch({
        folders: state.get().folders.filter((folder) => folder.id !== id),
        ...clearDeletedFolder(state.get().agents, id),
      });
    },
    newThread,
    reloadThreads: loadThreads,
    loadArchivedThreads,
    openThread: setOpen,
    markFinished: (agentId, threadId) => {
      void refreshSummary();
      const current = state.get();
      if (current.selectedAgentId === agentId && current.openThread[agentId] === threadId) return;
      patch({ unread: { ...current.unread, [threadId]: agentId } });
    },
    renameThread: async (agentId, threadId, title) => {
      const result = await api.renameThread(threadId, title);
      if (result.kind === 'failed') patch({ problem: result.error.message });
      else setThreads(agentId, { kind: 'loaded', value: threadsOf(agentId).map((each) => (each.id === threadId ? result.value : each)) });
    },
    archiveThread: async (agentId, threadId) => {
      const result = await api.archiveThread(threadId);
      if (result.kind === 'failed') {
        patch({ problem: result.error.message });
        return;
      }
      threadLoads.set(agentId, ++threadSeq);
      archivedLoads.set(agentId, ++threadSeq);
      state.update((current) => ({ ...current, unread: seen(current.unread, threadId) }));
      const remaining = threadsOf(agentId).filter(({ id }) => id !== threadId);
      setThreads(agentId, { kind: 'loaded', value: remaining });
      const archivedState = state.get().archivedThreads[agentId];
      if (archivedState?.kind === 'loaded') {
        setArchived(agentId, { kind: 'loaded', value: [result.value, ...archivedOf(agentId).filter(({ id }) => id !== threadId)] });
      } else if (archivedState?.kind === 'loading') {
        void loadArchivedThreads(agentId);
      }
      if (state.get().openThread[agentId] === threadId) setOpen(agentId, mainThread(remaining)?.id);
      options.onThreadsArchived?.([threadId]);
      void refreshSummary();
    },
    restoreThread: async (agentId, threadId) => {
      const result = await api.restoreThread(threadId);
      if (result.kind === 'failed') {
        patch({ problem: result.error.message });
        return;
      }
      threadLoads.set(agentId, ++threadSeq);
      archivedLoads.set(agentId, ++threadSeq);
      const archivedState = state.get().archivedThreads[agentId];
      if (archivedState?.kind === 'loaded') {
        setArchived(agentId, { kind: 'loaded', value: archivedOf(agentId).filter(({ id }) => id !== threadId) });
      } else if (archivedState?.kind === 'loading') {
        void loadArchivedThreads(agentId);
      }
      setThreads(agentId, { kind: 'loaded', value: byNewest([result.value, ...threadsOf(agentId).filter(({ id }) => id !== threadId)]) });
      setOpen(agentId, result.value.id);
      void refreshSummary();
    },
    deleteThread: async (agentId, threadId) => {
      const result = await api.deleteThread(threadId);
      if (result.kind === 'failed') {
        patch({ problem: result.error.message });
        return;
      }
      state.update((current) => ({ ...current, unread: seen(current.unread, threadId) }));
      const remaining = threadsOf(agentId).filter(({ id }) => id !== threadId);
      setThreads(agentId, { kind: 'loaded', value: remaining });
      if (state.get().archivedThreads[agentId]?.kind === 'loaded') {
        setArchived(agentId, { kind: 'loaded', value: archivedOf(agentId).filter(({ id }) => id !== threadId) });
      }
      if (state.get().openThread[agentId] === threadId) setOpen(agentId, mainThread(remaining)?.id);
      options.onThreadsDeleted?.([threadId]);
      void refreshSummary();
      await loadThreads(agentId);
    },
    touchThread: async (agentId, threadId, firstText) => {
      void refreshSummary();
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
    instructionsEditor: (agentId) => createInstructionsEditor(api, agentId),
    memoriesEditor: (agentId) => createMemoriesEditor(api, agentId),
    skills: (agentId) => loadSkills(api, agentId),
    dismissProblem: () => {
      patch({ problem: null });
    },
    close: stopRestarts,
  };
}
