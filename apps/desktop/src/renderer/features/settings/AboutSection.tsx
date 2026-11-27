import type { UpdateStatus } from '../../bridge.ts';
import { PLATFORM } from '../../shared/keys.ts';
import { displayPath, type AppInfo } from '../../shared/privacy.ts';
import { updateNote } from '../../shared/updates.ts';
import { LICENCES } from './licences.ts';
import { ROWS } from './settings-index.ts';
import { SettingRow } from './SettingRow.tsx';

export interface AboutSectionProps {
  readonly info: AppInfo | null;
  readonly update: UpdateStatus;
  readonly onRevealData: () => void;
  readonly onCheckForUpdates: () => void;
  readonly onRestartToUpdate: () => void;
}

/** Settings › About: version, licence and publisher, updates, the data folder, and bundled licences. */
export function AboutSection(props: AboutSectionProps) {
  const { info, update } = props;
  const busy = update.kind === 'checking' || update.kind === 'downloading';
  return (
    <>
      <SettingRow entry={ROWS.version}>
        <span class="mono">{info === null ? 'Not reported' : info.appVersion}</span>
      </SettingRow>
      <SettingRow entry={ROWS.updates}>
        <span class="setting-note" role="status">{updateNote(update)}</span>
        {update.kind === 'ready' ? (
          <button type="button" class="btn primary" onClick={props.onRestartToUpdate}>
            Restart to update
          </button>
        ) : (
          <button type="button" class="btn secondary" disabled={update.kind === 'unsupported' || busy} onClick={props.onCheckForUpdates}>
            Check for updates
          </button>
        )}
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
