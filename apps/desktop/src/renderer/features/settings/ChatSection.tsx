import type { ChatPrefs, ChatPrefsModel, Notify, SendWith, ToolActivity } from '../../shared/chat-prefs.ts';
import type { ChatSettingsModel } from '../../shared/chat-settings.ts';
import { sendKeyLabels, type Platform } from '../../shared/keys.ts';
import { Segmented } from '../../shared/ui/Segmented.tsx';
import { EmojiRepliesRow } from './EmojiRepliesRow.tsx';
import { ROWS } from './settings-index.ts';
import { SettingRow } from './SettingRow.tsx';

/** Settings › Chat. */
export function ChatSection(props: { readonly prefs: ChatPrefs; readonly onChange: ChatPrefsModel['set']; readonly platform: Platform; readonly chatSettings: ChatSettingsModel }) {
  return (
    <>
    <SettingRow entry={ROWS.sendWith}>
      <Segmented<SendWith>
        label={ROWS.sendWith.label}
        value={props.prefs.sendWith}
        onChange={(sendWith) => {
          props.onChange({ sendWith });
        }}
        options={[
          { value: 'enter', label: sendKeyLabels('enter', props.platform).send },
          { value: 'mod-enter', label: sendKeyLabels('mod-enter', props.platform).send },
        ]}
      />
    </SettingRow>
    <SettingRow entry={ROWS.notifications}>
      <Segmented<Notify>
        label={ROWS.notifications.label}
        value={props.prefs.notify}
        onChange={(notify) => {
          props.onChange({ notify });
        }}
        options={[
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ]}
      />
    </SettingRow>
    <SettingRow entry={ROWS.toolActivity}>
      <Segmented<ToolActivity>
        label={ROWS.toolActivity.label}
        value={props.prefs.toolActivity}
        onChange={(toolActivity) => {
          props.onChange({ toolActivity });
        }}
        options={[
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ]}
      />
    </SettingRow>
    <EmojiRepliesRow model={props.chatSettings} />
    </>
  );
}
