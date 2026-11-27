import type { SendWith } from '../../shared/chat-prefs.ts';
import type { Platform } from '../../shared/keys.ts';
import { KEY_ROWS, keysOf } from './settings-index.ts';
import { SettingRow } from './SettingRow.tsx';

/** Settings › Keyboard: a read-only list of the keys that work today (spec §6.1). */
export function KeyboardSection(props: { readonly platform: Platform; readonly sendWith: SendWith }) {
  return (
    <>
      {KEY_ROWS.map(({ id, entry }) => (
        <SettingRow key={id} entry={entry}>
          <kbd>{keysOf(id, props.platform, props.sendWith)}</kbd>
        </SettingRow>
      ))}
    </>
  );
}
