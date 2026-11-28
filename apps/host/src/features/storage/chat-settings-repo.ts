import type { DatabaseSync } from 'node:sqlite';
import { ChatSettings } from '@morrowbot/contracts';
import { z } from 'zod';

const SettingsRow = z
  .object({ emoji_replies: z.string() })
  .transform((row) => ({ emojiReplies: row.emoji_replies }))
  .pipe(ChatSettings);

/** The host's one row of chat settings (Settings › Chat). */
export interface ChatSettingsRepository {
  get(): ChatSettings;
  set(settings: ChatSettings): void;
}

export function chatSettingsRepository(db: DatabaseSync): ChatSettingsRepository {
  const get = db.prepare('SELECT emoji_replies FROM chat_settings WHERE id = 1');
  const set = db.prepare('UPDATE chat_settings SET emoji_replies = :emojiReplies WHERE id = 1');
  return {
    get: () => SettingsRow.parse(get.get()),
    set: (settings) => {
      set.run({ emojiReplies: settings.emojiReplies });
    },
  };
}
