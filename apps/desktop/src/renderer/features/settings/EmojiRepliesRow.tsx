import type { EmojiRepliesSetting } from '@morrowbot/contracts';
import { useEffect, useState } from 'preact/hooks';
import type { ChatSettingsModel } from '../../shared/chat-settings.ts';
import { Segmented } from '../../shared/ui/Segmented.tsx';
import { useStore } from '../../shared/use-store.ts';
import { ROWS } from './settings-index.ts';
import { SettingRow } from './SettingRow.tsx';

/**
 * Settings › Chat › Emoji-only / silent replies. Unlike the other chat settings it lives on the server, so it
 * loads on open and saves at once; a refusal shows under the control and the control goes back to what the server has.
 */
export function EmojiRepliesRow(props: { readonly model: ChatSettingsModel }) {
  const { model } = props;
  const settings = useStore(model.state);
  const [pending, setPending] = useState<EmojiRepliesSetting | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    void model.load();
  }, [model]);
  const loaded = settings.kind === 'loaded';
  const shown = pending ?? (loaded ? settings.value.emojiReplies : 'per_agent');
  return (
    <SettingRow entry={ROWS.emojiReplies}>
      <Segmented<EmojiRepliesSetting>
        label={ROWS.emojiReplies.label}
        value={shown}
        onChange={(emojiReplies) => {
          setPending(emojiReplies);
          setProblem(null);
          void model.setEmojiReplies(emojiReplies).then((refused) => {
            setPending(null);
            setProblem(refused);
          });
        }}
        options={[
          { value: 'per_agent', label: 'Per agent', disabled: !loaded || pending !== null },
          { value: 'all', label: 'All agents', disabled: !loaded || pending !== null },
          { value: 'off', label: 'Off (always reply with text)', disabled: !loaded || pending !== null },
        ]}
      />
      {settings.kind === 'failed' && (
        <p class="pair-error" role="alert">
          {`Couldn't load this setting: ${settings.message} `}
          <button type="button" class="ghost" onClick={() => void model.load()}>Try again</button>
        </p>
      )}
      {problem !== null && (
        <p class="pair-error" role="alert">
          {`Couldn't save: ${problem}`}
        </p>
      )}
    </SettingRow>
  );
}
