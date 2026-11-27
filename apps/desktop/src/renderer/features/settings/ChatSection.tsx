import type { ChatPrefs, ChatPrefsModel, SendWith } from '../../shared/chat-prefs.ts';
import { sendKeyLabels, type Platform } from '../../shared/keys.ts';
import { Segmented } from '../../shared/ui/Segmented.tsx';
import { ROWS } from './settings-index.ts';
import { SettingRow } from './SettingRow.tsx';

/** Settings › Chat. */
export function ChatSection(props: { readonly prefs: ChatPrefs; readonly onChange: ChatPrefsModel['set']; readonly platform: Platform }) {
  return (
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
  );
}
