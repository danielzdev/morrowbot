import { useEffect, useState } from 'preact/hooks';
import type { Appearance, AppearanceModel, ChatWidth, ReduceMotion, Theme } from '../../shared/appearance.ts';
import { DEFAULT_CUSTOM_BUBBLE_COLOR, swatchNameOf, type BubbleColorGlobal } from '../../shared/bubble-color.ts';
import { BubbleColorPicker, BubblePreview } from '../../shared/ui/BubbleColorPicker.tsx';
import { Segmented } from '../../shared/ui/Segmented.tsx';
import { Toggle } from '../../shared/ui/Toggle.tsx';
import { ROWS } from './settings-index.ts';
import { SettingRow } from './SettingRow.tsx';

type MessageColorMode = BubbleColorGlobal['kind'];

export interface SampleAgent {
  readonly name: string;
  readonly color: string;
}

/** Settings › Appearance: theme, message color, Send color, chat width and motion, applied as soon as they change. */
export function AppearanceSection(props: {
  readonly appearance: Appearance;
  readonly onChange: AppearanceModel['set'];
  readonly sampleAgent?: SampleAgent;
}) {
  const { appearance, onChange } = props;
  const [lastCustom, setLastCustom] = useState(
    appearance.messageColor.kind === 'custom' ? appearance.messageColor.color : DEFAULT_CUSTOM_BUBBLE_COLOR,
  );
  useEffect(() => {
    if (appearance.messageColor.kind === 'custom') setLastCustom(appearance.messageColor.color);
  }, [appearance.messageColor]);

  const sampleColor = props.sampleAgent?.color ?? DEFAULT_CUSTOM_BUBBLE_COLOR;
  const previewCaption = (() => {
    switch (appearance.messageColor.kind) {
      case 'match-bot':
        return props.sampleAgent === undefined ? 'Matches each bot' : `Matches ${props.sampleAgent.name}`;
      case 'off':
        return 'Default (neutral)';
      case 'custom':
        return `Custom · ${swatchNameOf(appearance.messageColor.color)}`;
    }
  })();

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
      <SettingRow
        entry={ROWS.messageColor}
        extra={
          <div class="bubble-setting-extra">
            {appearance.messageColor.kind === 'custom' && (
              <BubbleColorPicker
                label="Custom message color"
                value={appearance.messageColor.color}
                onChange={(color) => {
                  setLastCustom(color);
                  onChange({ messageColor: { kind: 'custom', color } });
                }}
              />
            )}
            <BubblePreview global={appearance.messageColor} agentColor={sampleColor} caption={previewCaption} />
          </div>
        }
      >
        <Segmented<MessageColorMode>
          label={ROWS.messageColor.label}
          value={appearance.messageColor.kind}
          onChange={(mode) => {
            switch (mode) {
              case 'match-bot':
                onChange({ messageColor: { kind: 'match-bot' } });
                break;
              case 'off':
                onChange({ messageColor: { kind: 'off' } });
                break;
              case 'custom':
                onChange({ messageColor: { kind: 'custom', color: lastCustom } });
                break;
            }
          }}
          options={[
            { value: 'match-bot', label: 'Match bot' },
            { value: 'off', label: 'Off' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
      </SettingRow>
      <SettingRow entry={ROWS.sendColor}>
        <Toggle
          label={ROWS.sendColor.label}
          checked={appearance.sendInAgentColor}
          onChange={(sendInAgentColor) => {
            onChange({ sendInAgentColor });
          }}
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
