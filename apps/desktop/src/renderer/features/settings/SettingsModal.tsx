import type { Appearance, ReduceMotion, Theme } from '../../shared/appearance.ts';
import { displayPath, type AppInfo } from '../../shared/privacy.ts';
import { Segmented } from '../../shared/ui/Segmented.tsx';
import { SettingsShell, type SettingsNavGroup } from '../../shared/ui/SettingsShell.tsx';
import { SettingRow } from './SettingRow.tsx';

export type SettingsSection = 'appearance' | 'about';

const NAV: readonly SettingsNavGroup[] = [
  { label: 'App', items: [{ id: 'appearance', label: 'Appearance', icon: 'sun' }] },
  { label: null, items: [{ id: 'about', label: 'About', icon: 'info' }] },
];

const TITLES: Readonly<Record<SettingsSection, string>> = { appearance: 'Appearance', about: 'About' };

const isSection = (id: string): id is SettingsSection => id in TITLES;

export interface SettingsModalProps {
  readonly section: SettingsSection;
  readonly onSection: (section: SettingsSection) => void;
  readonly onClose: () => void;
  readonly appearance: Appearance;
  readonly onTheme: (theme: Theme) => void;
  readonly onReduceMotion: (value: ReduceMotion) => void;
  readonly info: AppInfo | null;
  readonly onRevealData: () => void;
}

/** App settings (⌘,) in the shared Settings shell. */
export function SettingsModal(props: SettingsModalProps) {
  return (
    <SettingsShell
      label="Settings"
      groups={NAV}
      selected={props.section}
      onSelect={(id) => {
        if (isSection(id)) props.onSection(id);
      }}
      breadcrumb={['Settings', TITLES[props.section]]}
      onClose={props.onClose}
    >
      {props.section === 'appearance' ? (
        <>
          <SettingRow label="Theme" description="Follow the system, or always use light or dark.">
            <Segmented<Theme>
              label="Theme"
              value={props.appearance.theme}
              onChange={props.onTheme}
              options={[
                { value: 'system', label: 'System', icon: 'monitor' },
                { value: 'light', label: 'Light', icon: 'sun' },
                { value: 'dark', label: 'Dark', icon: 'moon' },
              ]}
            />
          </SettingRow>
          <SettingRow label="Reduce motion" description="On stills avatars and slide-ins. Your system's reduce-motion setting always applies.">
            <Segmented<ReduceMotion>
              label="Reduce motion"
              value={props.appearance.reduceMotion}
              onChange={props.onReduceMotion}
              options={[
                { value: 'system', label: 'System' },
                { value: 'on', label: 'On' },
              ]}
            />
          </SettingRow>
        </>
      ) : (
        <>
          <SettingRow label="MorrowBot" description="Apache License 2.0 · Published by Legendary Koi">
            <span class="mono">{props.info?.appVersion ?? 'Not reported'}</span>
          </SettingRow>
          <SettingRow label="Data folder" description={props.info === null ? 'Not reported' : displayPath(props.info.dataDir, props.info)}>
            <button type="button" class="btn secondary" disabled={props.info === null} onClick={props.onRevealData}>
              Reveal in Finder
            </button>
          </SettingRow>
        </>
      )}
    </SettingsShell>
  );
}
