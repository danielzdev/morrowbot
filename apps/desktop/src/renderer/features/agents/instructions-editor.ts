import type { AgentInstructionsView } from '@morrowbot/contracts';
import type { Api, ApiFailure } from '../../shared/api.ts';
import { Store } from '../../shared/store.ts';

/** What the last save did. The draft is kept in every case. */
export type SaveOutcome =
  | { readonly kind: 'created' }
  /** The live file was left as it is; the draft was written as a copy in the data folder. */
  | { readonly kind: 'copied'; readonly revealId: string; readonly content: string }
  /** The file on disk is not the one the editor loaded; nothing was written. */
  | { readonly kind: 'conflict'; readonly current: AgentInstructionsView }
  | { readonly kind: 'failed'; readonly message: string };

export type InstructionsEditorState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'load-failed'; readonly message: string }
  | {
      readonly kind: 'ready';
      /** The snapshot every save is checked against. */
      readonly loaded: AgentInstructionsView;
      readonly draft: string;
      readonly saving: boolean;
      readonly outcome: SaveOutcome | null;
    };

/** How Save behaves for the loaded file in v1: create a missing one, else keep a copy. */
export type SaveMode = 'create' | 'copy';

export const saveModeOf = (loaded: AgentInstructionsView): SaveMode => (loaded.revision === null ? 'create' : 'copy');

/** Whether the draft holds text that is neither on disk nor in a saved copy. */
export function isDirty(state: InstructionsEditorState): boolean {
  if (state.kind !== 'ready') return false;
  if (state.outcome?.kind === 'copied' && state.outcome.content === state.draft) return false;
  return state.draft !== (state.loaded.content ?? '');
}

export interface InstructionsEditor {
  readonly state: Store<InstructionsEditorState>;
  load(): Promise<void>;
  setDraft(draft: string): void;
  /** Save (create) for a missing file; Save a copy, after checking the revision, for an existing one. */
  save(): Promise<void>;
  /** Writes the draft straight to a copy: the conflict's "Save mine as a copy". */
  saveCopy(): Promise<void>;
  /** The conflict's "Use disk version": the disk text replaces the draft. */
  useDisk(): void;
}

type Port = Pick<Api, 'instructions' | 'saveInstructions' | 'saveInstructionsCopy'>;

const failed = (result: ApiFailure): SaveOutcome =>
  result.error.kind === 'instructions-conflict' ? { kind: 'conflict', current: result.error.current } : { kind: 'failed', message: result.error.message };

/**
 * The AGENTS.md editor of one agent (spec §5.2, H8 v1). Saves run one at a time, each checked
 * against the revision that was loaded; an existing file is never replaced.
 */
export function createInstructionsEditor(api: Port, agentId: string): InstructionsEditor {
  const state = new Store<InstructionsEditorState>({ kind: 'loading' });
  const ready = (): Extract<InstructionsEditorState, { kind: 'ready' }> | null => {
    const current = state.get();
    return current.kind === 'ready' ? current : null;
  };
  const patch = (change: Partial<Omit<Extract<InstructionsEditorState, { kind: 'ready' }>, 'kind'>>): void => {
    const current = ready();
    if (current !== null) state.set({ ...current, ...change });
  };
  const copy = async (content: string): Promise<SaveOutcome> => {
    const result = await api.saveInstructionsCopy(agentId, content);
    return result.kind === 'ok' ? { kind: 'copied', revealId: result.value.revealId, content } : failed(result);
  };
  const run = async (work: (current: Extract<InstructionsEditorState, { kind: 'ready' }>) => Promise<void>): Promise<void> => {
    const current = ready();
    if (current === null || current.saving) return;
    patch({ saving: true });
    await work(current);
    patch({ saving: false });
  };

  return {
    state,
    load: async () => {
      state.set({ kind: 'loading' });
      const result = await api.instructions(agentId);
      state.set(
        result.kind === 'ok'
          ? { kind: 'ready', loaded: result.value, draft: result.value.content ?? '', saving: false, outcome: null }
          : { kind: 'load-failed', message: result.error.message },
      );
    },
    setDraft: (draft) => {
      patch({ draft });
    },
    save: () =>
      run(async ({ loaded, draft }) => {
        if (saveModeOf(loaded) === 'create') {
          const result = await api.saveInstructions(agentId, draft, null);
          if (result.kind === 'ok') patch({ loaded: { content: draft, revision: result.value.revision, canReplace: false }, outcome: { kind: 'created' } });
          else patch({ outcome: failed(result) });
          return;
        }
        const latest = await api.instructions(agentId);
        if (latest.kind !== 'ok') {
          patch({ outcome: failed(latest) });
          return;
        }
        const now = latest.value;
        const unchanged = now.revision === loaded.revision || (now.content !== null && loaded.content !== null && now.content === loaded.content);
        if (!unchanged) {
          patch({ outcome: { kind: 'conflict', current: now } });
          return;
        }
        patch({ loaded: now, outcome: await copy(draft) });
      }),
    saveCopy: () =>
      run(async ({ draft, outcome, loaded }) => {
        const resolved = outcome?.kind === 'conflict' ? outcome.current : loaded;
        const saved = await copy(draft);
        patch(saved.kind === 'copied' ? { loaded: resolved, outcome: saved } : { outcome: saved });
      }),
    useDisk: () => {
      const current = ready();
      if (current === null || current.saving || current.outcome?.kind !== 'conflict' || current.outcome.current.content === null) return;
      const disk = current.outcome.current;
      state.set({ ...current, loaded: disk, draft: disk.content ?? '', outcome: null });
    },
  };
}
