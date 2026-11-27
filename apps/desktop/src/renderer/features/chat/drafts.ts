import { z } from 'zod';
import { readPref, removePref, writePref } from '../../shared/local-pref.ts';

/** Where each chat's unsent message is kept. */
export interface DraftStore {
  read(threadId: string): string;
  /** An empty draft is removed. */
  write(threadId: string, text: string): void;
}

const keyOf = (threadId: string): string => `morrowbot.draft.${threadId}`;

/** Drafts in this window's local storage, so they survive a reload or a host restart (spec §9). */
export const localDrafts: DraftStore = {
  read: (threadId) => readPref(keyOf(threadId), z.string(), ''),
  write: (threadId, text) => {
    if (text === '') removePref(keyOf(threadId));
    else writePref(keyOf(threadId), text);
  },
};

/** Drafts held only while this window runs. */
export function memoryDrafts(): DraftStore {
  const drafts = new Map<string, string>();
  return {
    read: (threadId) => drafts.get(threadId) ?? '',
    write: (threadId, text) => {
      if (text === '') drafts.delete(threadId);
      else drafts.set(threadId, text);
    },
  };
}
