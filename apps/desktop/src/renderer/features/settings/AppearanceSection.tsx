import type { Appearance, AppearanceModel, ChatWidth, ReduceMotion, Theme } from '../../shared/appearance.ts';
import { Segmented } from '../../shared/ui/Segmented.tsx';
import { ROWS } from './settings-index.ts';
import { SettingRow } from './SettingRow.tsx';

/** Settings › Appearance: theme, chat width and motion, applied as soon as they change. */
export function AppearanceSection(props: { readonly appearance: Appearance; readonly onChange: AppearanceModel['set'] }) {
  const { appearance, onChange } = props;
  return (
    <>
      <SettingRow entry={ROWS.theme}>
        <Segmented<Theme>
          label={ROWS.theme.label}
          value={appearance.theme}
          onChange={(theme) => {
            onChange({ theme });
          }}
          options={[
            { value: 'system', label: 'System', icon: 'monitor' },
            { value: 'light', label: 'Light', icon: 'sun' },
            { value: 'dark', label: 'Dark', icon: 'moon' },
          ]}
        />
      </SettingRow>
      <SettingRow entry={ROWS.chatWidth}>
        <Segmented<ChatWidth>
          label={ROWS.chatWidth.label}
          value={appearance.chatWidth}
          onChange={(chatWidth) => {
            onChange({ chatWidth });
          }}
          options={[
            { value: 'normal', label: 'Normal' },
            { value: 'wide', label: 'Wide' },
          ]}
        />
      </SettingRow>
      <SettingRow entry={ROWS.reduceMotion}>
        <Segmented<ReduceMotion>
          label={ROWS.reduceMotion.label}
          value={appearance.reduceMotion}
          onChange={(reduceMotion) => {
            onChange({ reduceMotion });
          }}
          options={[
            { value: 'system', label: 'System' },
            { value: 'on', label: 'On' },
          ]}
        />
      </SettingRow>
    </>
  );
}
