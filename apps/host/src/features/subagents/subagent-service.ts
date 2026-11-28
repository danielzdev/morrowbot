import {
  MAX_ACTIVE_SUBAGENTS,
  MAX_SUBAGENTS_PER_TURN,
  type BoundProvider,
  type ChatEvent,
  type ProviderInfo,
  type SubagentRun,
  type Thread,
} from '@morrowbot/contracts';
import { modelsShown, targetBinding, type SpawnRequest } from './rules.ts';

/** The turn asking: its id, its agent and its chat (a tool grant). */
export interface Caller {
  readonly turnId: string;
  readonly agentId: string;
  readonly threadId: string;
}

/** What the sub-agents feature acts on (the chat, storage and plugins features provide it). */
export interface SubagentPorts {
  readonly chat: {
    /** The running turn, undefined once it settles or is stopping. */
    parentTurn(generationId: string): { readonly threadId: string; readonly agentId: string; readonly binding: BoundProvider; readonly isSubagent: boolean } | undefined;
    start(threadId: string, text: string): Promise<{ readonly kind: 'started'; readonly run: SubagentRun } | { readonly kind: 'refused'; readonly reason: string }>;
    run(threadId: string): SubagentRun | undefined;
    runs(parentThreadId: string): SubagentRun[];
    subscribe(listener: (event: ChatEvent) => void): () => void;
  };
  readonly records: {
    /** Saves the sub-agent's chat as a hidden child of the parent's, with its record. */
    insert(thread: Thread, record: { readonly threadId: string; readonly parentThreadId: string; readonly parentGenerationId: string; readonly role: string; readonly binding: BoundProvider; readonly createdAt: string }): void;
    isSubagent(threadId: string): boolean;
    deleteThread(threadId: string): void;
  };
  readonly providers: {
    ids(): string[];
    info(pluginId: string): Promise<ProviderInfo | undefined>;
  };
  readonly newId: () => string;
  readonly now: () => string;
}

export type Spawned = { readonly kind: 'started'; readonly run: SubagentRun } | { readonly kind: 'refused'; readonly reason: string };
export type Waited = { readonly kind: 'waited'; readonly runs: SubagentRun[]; readonly timedOut: boolean } | { readonly kind: 'refused'; readonly reason: string };
export type Listed =
  | { readonly kind: 'listed'; readonly you: BoundProvider; readonly runs: SubagentRun[]; readonly providers: object[] }
  | { readonly kind: 'refused'; readonly reason: string };

export interface SubagentService {
  /** A sub-agent's own chat: its turn gets no sub-agent tools (sub-agents are one level deep). */
  isSubagent(threadId: string): boolean;
  spawn(caller: Caller, request: SpawnRequest): Promise<Spawned>;
  /** Resolves once every named run (all of the caller's turn when none are named) has finished, or at `timeoutMs`. */
  wait(caller: Caller, runIds: readonly string[] | undefined, timeoutMs: number): Promise<Waited>;
  list(caller: Caller): Promise<Listed>;
}

type Parent = { readonly kind: 'ok'; readonly binding: BoundProvider } | { readonly kind: 'refused'; readonly reason: string };

const finished = (run: SubagentRun): boolean => run.status.kind === 'finished';

export function createSubagentService(ports: SubagentPorts): SubagentService {
  const { chat, records } = ports;

  /** The caller's turn, if it may start sub-agents now. */
  function parentOf(caller: Caller): Parent {
    const parent = chat.parentTurn(caller.turnId);
    if (parent?.threadId !== caller.threadId || parent.agentId !== caller.agentId) return { kind: 'refused', reason: 'Your turn has ended.' };
    if (parent.isSubagent || records.isSubagent(caller.threadId)) return { kind: 'refused', reason: 'A sub-agent cannot start sub-agents.' };
    return { kind: 'ok', binding: parent.binding };
  }

  /** Why the caller's turn may not start one more sub-agent, or undefined. Checked right before the write. */
  function overCap(caller: Caller): string | undefined {
    const mine = chat.runs(caller.threadId).filter(({ parentGenerationId }) => parentGenerationId === caller.turnId);
    if (mine.length >= MAX_SUBAGENTS_PER_TURN) return `One turn may start at most ${String(MAX_SUBAGENTS_PER_TURN)} sub-agents.`;
    if (mine.filter((run) => !finished(run)).length >= MAX_ACTIVE_SUBAGENTS) {
      return `At most ${String(MAX_ACTIVE_SUBAGENTS)} sub-agents run at once: wait_subagents for one to finish first.`;
    }
    return undefined;
  }

  return {
    isSubagent: (threadId) => records.isSubagent(threadId),
    spawn: async (caller, request) => {
      const first = parentOf(caller);
      if (first.kind === 'refused') return first;
      const pluginId = request.provider ?? first.binding.pluginId;
      if (!ports.providers.ids().includes(pluginId)) return { kind: 'refused', reason: `There is no provider ${pluginId}. See list_subagents.` };
      const target = targetBinding(first.binding, request, await ports.providers.info(pluginId));
      if (target.kind === 'refused') return target;
      // Synchronous from here: the turn and the caps are checked again right before the sub-agent is written.
      const parent = parentOf(caller);
      if (parent.kind === 'refused') return parent;
      const capped = overCap(caller);
      if (capped !== undefined) return { kind: 'refused', reason: capped };
      const at = ports.now();
      const thread: Thread = { id: ports.newId(), agentId: caller.agentId, title: request.role, createdAt: at, updatedAt: at };
      records.insert(thread, {
        threadId: thread.id,
        parentThreadId: caller.threadId,
        parentGenerationId: caller.turnId,
        role: request.role,
        binding: target.binding,
        createdAt: at,
      });
      const started = await chat.start(thread.id, request.prompt);
      if (started.kind === 'refused') records.deleteThread(thread.id);
      return started;
    },
    wait: async (caller, runIds, timeoutMs) => {
      const ids = runIds ?? chat.runs(caller.threadId).filter((run) => run.parentGenerationId === caller.turnId).map(({ id }) => id);
      const unknown = ids.filter((id) => chat.run(id)?.parentThreadId !== caller.threadId);
      if (unknown.length > 0) return { kind: 'refused', reason: `Not a sub-agent of this chat: ${unknown.join(', ')}` };
      const current = (): SubagentRun[] => ids.flatMap((id) => chat.run(id) ?? []);
      if (current().every(finished)) return { kind: 'waited', runs: current(), timedOut: false };
      const watched = new Set(ids);
      const timedOut = await new Promise<boolean>((resolve) => {
        const stop = chat.subscribe((event) => {
          if (event.kind !== 'subagent.changed' || !watched.has(event.run.id) || !current().every(finished)) return;
          end(false);
        });
        const timer = setTimeout(() => {
          end(true);
        }, timeoutMs);
        function end(late: boolean): void {
          clearTimeout(timer);
          stop();
          resolve(late);
        }
      });
      return { kind: 'waited', runs: current(), timedOut };
    },
    list: async (caller) => {
      const parent = parentOf(caller);
      if (parent.kind === 'refused') return parent;
      const providers = await Promise.all(
        ports.providers.ids().map(async (pluginId) => {
          const info = await ports.providers.info(pluginId);
          switch (info?.kind) {
            case 'ready':
              return [{ provider: pluginId, models: modelsShown(info.models) }];
            case 'ready-models-later':
              return [{ provider: pluginId, models: [] }];
            case undefined:
            case 'missing-runtime':
            case 'outdated':
            case 'signed-out':
            case 'error':
              return [];
          }
        }),
      );
      return { kind: 'listed', you: parent.binding, runs: chat.runs(caller.threadId), providers: providers.flat() };
    },
  };
}
