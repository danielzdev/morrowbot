import { PLATFORM } from '../../shared/keys.ts';
import { displayPath, type AppInfo } from '../../shared/privacy.ts';
import { LICENCES } from './licences.ts';
import { ROWS } from './settings-index.ts';
import { SettingRow } from './SettingRow.tsx';

/** Settings › About: version, licence and publisher, the data folder, and bundled licences. */
export function AboutSection(props: { readonly info: AppInfo | null; readonly onRevealData: () => void }) {
  const { info } = props;
  return (
    <>
      <SettingRow entry={ROWS.version}>
        <span class="mono">{info === null ? 'Not reported' : info.appVersion}</span>
      </SettingRow>
      <SettingRow entry={ROWS.dataFolder}>
        <span class="mono setting-value">{info === null ? 'Not reported' : displayPath(info.dataDir, info)}</span>
        <button type="button" class="btn secondary" disabled={info === null} onClick={props.onRevealData}>
          {PLATFORM === 'mac' ? 'Reveal in Finder' : 'Show in folder'}
        </button>
      </SettingRow>
      <SettingRow entry={ROWS.licences}>
        <ul class="licence-list" aria-label={ROWS.licences.label}>
          {LICENCES.map((item) => (
            <li key={item.name}>
              <span>{item.name}</span>
              <span class="mono">{item.licence}</span>
            </li>
          ))}
        </ul>
      </SettingRow>
    </>
  );
}
