import { useEffect, useState } from 'preact/hooks';
import type { MorrowbotBridge } from '../../bridge.ts';
import { Toggle } from '../../shared/ui/Toggle.tsx';
import { loadLoginItem, type LoginItemState } from './login-item.ts';
import { ROWS } from './settings-index.ts';
import { SettingRow } from './SettingRow.tsx';

const NOTE: Readonly<Record<Exclude<LoginItemState['kind'], 'supported'>, string>> = {
  loading: 'Checking…',
  unsupported: 'Only in the installed app on macOS and Windows',
  failed: "Couldn't read this setting",
};

/** Settings › General. */
export function GeneralSection(props: { readonly bridge: Pick<MorrowbotBridge, 'loginItem' | 'setOpenAtLogin'> }) {
  const { bridge } = props;
  const [login, setLogin] = useState<LoginItemState>({ kind: 'loading' });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    void loadLoginItem(() => bridge.loginItem()).then((state) => {
      if (live) setLogin(state);
    });
    return () => {
      live = false;
    };
  }, [bridge]);
  return (
    <SettingRow entry={ROWS.openAtLogin}>
      {login.kind !== 'supported' && <span class="setting-note">{NOTE[login.kind]}</span>}
      <Toggle
        label={ROWS.openAtLogin.label}
        checked={login.kind === 'supported' && login.openAtLogin}
        disabled={login.kind !== 'supported' || saving}
        onChange={(open) => {
          setSaving(true);
          void loadLoginItem(() => bridge.setOpenAtLogin(open)).then((state) => {
            setLogin(state);
            setSaving(false);
          });
        }}
      />
    </SettingRow>
  );
}
