import { z } from 'zod';
import { readPref, writePref } from './local-pref.ts';
import { Store } from './store.ts';

/** Which key sends a message: Enter (⇧Enter adds a line), or ⌘Enter (Enter adds a line). */
export const SendWith = z.enum(['enter', 'mod-enter']);
export type SendWith = z.infer<typeof SendWith>;

const ChatPrefs = z.strictObject({ sendWith: SendWith });
export type ChatPrefs = z.infer<typeof ChatPrefs>;
const KEY = 'morrowbot.chat';

export interface ChatPrefsModel {
  readonly state: Store<ChatPrefs>;
  readonly set: (patch: Partial<ChatPrefs>) => void;
}

/** Owns Settings › Chat. */
export function createChatPrefs(): ChatPrefsModel {
  const state = new Store<ChatPrefs>(readPref<ChatPrefs>(KEY, ChatPrefs, { sendWith: 'enter' }));
  return {
    state,
    set: (patch) => {
      state.set({ ...state.get(), ...patch });
      writePref(KEY, state.get());
    },
  };
}
