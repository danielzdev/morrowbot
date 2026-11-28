import type { Memory, MemoryInclusion, SkillList } from '@morrowbot/contracts';
import type { Api } from '../../shared/api.ts';
import { Store, type Loadable } from '../../shared/store.ts';

export interface MemoriesState {
  readonly memories: Loadable<readonly Memory[]>;
  /** The search the list shows; '' lists every memory. */
  readonly query: string;
  /** Memory ids with a change on its way to the host. */
  readonly saving: readonly string[];
  readonly problem: string | null;
}

/** Agent Settings › Memories: list, search, add, edit and forget one agent's memories. */
export interface MemoriesEditor {
  readonly state: Store<MemoriesState>;
  load(): Promise<void>;
  search(query: string): Promise<void>;
  /** Resolves true once saved, so the form can clear. */
  add(text: string, inclusion: MemoryInclusion): Promise<boolean>;
  update(id: string, change: { readonly text?: string; readonly inclusion?: MemoryInclusion }): Promise<boolean>;
  forget(id: string): Promise<void>;
}

type MemoryApi = Pick<Api, 'memories' | 'createMemory' | 'updateMemory' | 'deleteMemory'>;

export function createMemoriesEditor(api: MemoryApi, agentId: string): MemoriesEditor {
  const state = new Store<MemoriesState>({ memories: { kind: 'loading' }, query: '', saving: [], problem: null });
  const patch = (change: Partial<MemoriesState>): void => {
    state.update((current) => ({ ...current, ...change }));
  };
  let loads = 0;
  const list = (): readonly Memory[] => {
    const { memories } = state.get();
    return memories.kind === 'loaded' ? memories.value : [];
  };
  const saving = (id: string, on: boolean): void => {
    const others = state.get().saving.filter((each) => each !== id);
    patch({ saving: on ? [...others, id] : others });
  };

  async function load(): Promise<void> {
    const mine = ++loads;
    const result = await api.memories(agentId, state.get().query);
    if (mine !== loads) return;
    patch(result.kind === 'ok' ? { memories: { kind: 'loaded', value: result.value.memories } } : { memories: { kind: 'failed', message: result.error.message } });
  }

  return {
    state,
    load,
    search: async (query) => {
      patch({ query });
      await load();
    },
    add: async (text, inclusion) => {
      const result = await api.createMemory(agentId, { text, inclusion });
      if (result.kind === 'failed') {
        patch({ problem: result.error.message });
        return false;
      }
      patch({ problem: null });
      await load();
      return true;
    },
    update: async (id, change) => {
      saving(id, true);
      const result = await api.updateMemory(agentId, id, change);
      saving(id, false);
      if (result.kind === 'failed') {
        patch({ problem: result.error.message });
        return false;
      }
      patch({ problem: null, memories: { kind: 'loaded', value: list().map((memory) => (memory.id === id ? result.value : memory)) } });
      return true;
    },
    forget: async (id) => {
      saving(id, true);
      const result = await api.deleteMemory(agentId, id);
      saving(id, false);
      if (result.kind === 'failed' && result.status !== 404) {
        patch({ problem: result.error.message });
        return;
      }
      patch({ problem: null, memories: { kind: 'loaded', value: list().filter((memory) => memory.id !== id) } });
    },
  };
}

/** The agent's skills, once. */
export async function loadSkills(api: Pick<Api, 'skills'>, agentId: string): Promise<Loadable<SkillList>> {
  const result = await api.skills(agentId);
  return result.kind === 'ok' ? { kind: 'loaded', value: result.value } : { kind: 'failed', message: result.error.message };
}
