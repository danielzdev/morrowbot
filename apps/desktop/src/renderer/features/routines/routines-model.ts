import type { CreateRoutineRequest, Routine, UpdateRoutineRequest } from '@morrowbot/contracts';
import type { z } from 'zod';
import type { MorrowbotBridge } from '../../bridge.ts';
import type { Api } from '../../shared/api.ts';
import { Store, type Loadable } from '../../shared/store.ts';

/** The routines of the agent whose settings are open. */
export interface RoutinesState {
  readonly agentId: string | null;
  readonly routines: Loadable<readonly Routine[]>;
  /** Routines with a Run now on its way to the host. */
  readonly starting: ReadonlySet<string>;
  /** Why the last action did not work. */
  readonly problem: string | null;
}

export type RoutineSaved = { readonly kind: 'saved' } | { readonly kind: 'refused'; readonly message: string };

export interface RoutinesModel {
  readonly state: Store<RoutinesState>;
  open(agentId: string): Promise<void>;
  create(request: z.input<typeof CreateRoutineRequest>): Promise<RoutineSaved>;
  update(id: string, request: UpdateRoutineRequest): Promise<RoutineSaved>;
  remove(id: string): Promise<void>;
  runNow(id: string): Promise<void>;
  dismissProblem(): void;
  close(): void;
}

export interface RoutinesModelOptions {
  readonly api: Api;
  readonly bridge: Pick<MorrowbotBridge, 'onHostReady'>;
  /** A run posted a reply in a new chat of this agent. */
  readonly onPosted: (agentId: string) => void;
  /** How often to look again while a run is going. */
  readonly pollMs?: number;
}

const isRunning = (routine: Routine): boolean => routine.lastRun?.result.kind === 'running';

export function createRoutinesModel(options: RoutinesModelOptions): RoutinesModel {
  const { api } = options;
  const state = new Store<RoutinesState>({ agentId: null, routines: { kind: 'loading' }, starting: new Set(), problem: null });
  let poll: ReturnType<typeof setTimeout> | undefined;
  let loads = 0;
  const patch = (change: Partial<RoutinesState>): void => {
    state.update((current) => ({ ...current, ...change }));
  };
  const listed = (): readonly Routine[] => {
    const { routines } = state.get();
    return routines.kind === 'loaded' ? routines.value : [];
  };
  const put = (routine: Routine): void => {
    const known = listed().some(({ id }) => id === routine.id);
    patch({ routines: { kind: 'loaded', value: known ? listed().map((each) => (each.id === routine.id ? routine : each)) : [...listed(), routine] } });
  };

  async function load(): Promise<void> {
    const { agentId } = state.get();
    if (agentId === null) return;
    const mine = ++loads;
    clearTimeout(poll);
    const before = new Map(listed().map((routine) => [routine.id, routine.lastRun]));
    const result = await api.listRoutines(agentId);
    if (mine !== loads || state.get().agentId !== agentId) return;
    if (result.kind === 'failed') {
      patch({ routines: { kind: 'failed', message: result.error.message } });
      return;
    }
    const { routines } = result.value;
    patch({ routines: { kind: 'loaded', value: routines } });
    const posted = routines.some((routine) => {
      if (routine.lastRun?.result.kind !== 'posted' || !before.has(routine.id)) return false;
      const earlier = before.get(routine.id);
      return earlier?.id !== routine.lastRun.id || earlier.result.kind !== 'posted';
    });
    if (posted) options.onPosted(agentId);
    if (routines.some(isRunning)) poll = setTimeout(() => void load(), options.pollMs ?? 1500);
  }

  const stopRestarts = options.bridge.onHostReady(() => void load());

  return {
    state,
    open: async (agentId) => {
      if (state.get().agentId !== agentId) patch({ agentId, routines: { kind: 'loading' }, starting: new Set(), problem: null });
      await load();
    },
    create: async (request) => {
      const result = await api.createRoutine(request);
      if (result.kind === 'failed') return { kind: 'refused', message: result.error.message };
      if (result.value.agentId === state.get().agentId) put(result.value);
      return { kind: 'saved' };
    },
    update: async (id, request) => {
      const result = await api.updateRoutine(id, request);
      if (result.kind === 'failed') {
        patch({ problem: result.error.message });
        return { kind: 'refused', message: result.error.message };
      }
      put(result.value);
      return { kind: 'saved' };
    },
    remove: async (id) => {
      const result = await api.deleteRoutine(id);
      if (result.kind === 'failed' && result.status !== 404) {
        patch({ problem: result.error.message });
        return;
      }
      patch({ routines: { kind: 'loaded', value: listed().filter((routine) => routine.id !== id) } });
    },
    runNow: async (id) => {
      patch({ starting: new Set([...state.get().starting, id]), problem: null });
      const result = await api.runRoutine(id);
      patch({ starting: new Set([...state.get().starting].filter((each) => each !== id)) });
      if (result.kind === 'failed') patch({ problem: result.error.message });
      await load();
    },
    dismissProblem: () => {
      patch({ problem: null });
    },
    close: () => {
      clearTimeout(poll);
      stopRestarts();
    },
  };
}
