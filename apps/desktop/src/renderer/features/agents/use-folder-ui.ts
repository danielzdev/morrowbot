import type { Folder } from '@morrowbot/contracts';
import { useState } from 'preact/hooks';
import { z } from 'zod';
import { readPref, writePref } from '../../shared/local-pref.ts';
import type { AgentsModel } from './agents-model.ts';

const FOLDED_KEY = 'morrowbot.sidebar.folded';
const Folded = z.array(z.string());

/** A new folder being named; `forAgent` moves that agent into it once it exists. */
export interface FolderDraft {
  readonly forAgent: string | null;
}

/** The sidebar's folder state: which sections are folded (kept per window), and the folder being made, renamed or deleted. */
export function useFolderUi(model: AgentsModel) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set(readPref<string[]>(FOLDED_KEY, Folded, [])));
  const [draft, setDraft] = useState<FolderDraft | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Folder | null>(null);

  return {
    folded,
    draft,
    renaming,
    deleting,
    toggle: (key: string): void => {
      const next = new Set(folded);
      if (!next.delete(key)) next.add(key);
      setFolded(next);
      writePref(FOLDED_KEY, [...next]);
    },
    startDraft: (forAgent: string | null): void => {
      setDraft({ forAgent });
    },
    finishDraft: async (name: string | null): Promise<void> => {
      const forAgent = draft?.forAgent ?? null;
      setDraft(null);
      if (name === null) return;
      const made = await model.createFolder(name);
      if (made.kind === 'saved' && forAgent !== null) await model.updateAgent(forAgent, { folderId: made.value.id });
    },
    startRename: setRenaming,
    finishRename: (id: string, name: string | null): void => {
      setRenaming(null);
      if (name !== null) void model.renameFolder(id, name);
    },
    askDelete: setDeleting,
    confirmDelete: (): void => {
      const folder = deleting;
      setDeleting(null);
      if (folder !== null) void model.deleteFolder(folder.id);
    },
  };
}
