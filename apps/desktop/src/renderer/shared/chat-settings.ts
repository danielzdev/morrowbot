import type { ChatSettings, EmojiRepliesSetting } from '@morrowbot/contracts';
import type { Api } from './api.ts';
import { Store, type Loadable } from './store.ts';

/** The chat settings the host owns (Settings › Chat › Emoji-only / silent replies), shared by every window and device. */
export interface ChatSettingsModel {
  readonly state: Store<Loadable<ChatSettings>>;
  /** Fetches the settings again. */
  load(): Promise<void>;
  /** Saves the setting; answers the host's reason when it refused, else null. */
  setEmojiReplies(emojiReplies: EmojiRepliesSetting): Promise<string | null>;
}

export function createChatSettings(api: Pick<Api, 'chatSettings' | 'saveChatSettings'>): ChatSettingsModel {
  const state = new Store<Loadable<ChatSettings>>({ kind: 'loading' });
  let loads = 0;
  return {
    state,
    load: async () => {
      const mine = ++loads;
      const result = await api.chatSettings();
      if (mine !== loads) return;
      state.set(result.kind === 'ok' ? { kind: 'loaded', value: result.value } : { kind: 'failed', message: result.error.message });
    },
    setEmojiReplies: async (emojiReplies) => {
      const result = await api.saveChatSettings({ emojiReplies });
      if (result.kind === 'failed') return result.error.message;
      loads++;
      state.set({ kind: 'loaded', value: result.value });
      return null;
    },
  };
}
