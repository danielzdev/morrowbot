import type { ComponentChildren } from 'preact';
import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { MorrowbotBridge, ServerMode, ServerRequest } from '../../bridge.ts';
import type { AppearanceModel } from '../../shared/appearance.ts';
import type { ChatPrefsModel } from '../../shared/chat-prefs.ts';
import { PLATFORM } from '../../shared/keys.ts';
import type { AppInfo } from '../../shared/privacy.ts';
import { SettingsShell } from '../../shared/ui/SettingsShell.tsx';
import type { UpdatesModel } from '../../shared/updates.ts';
import { useStore } from '../../shared/use-store.ts';
import { AboutSection } from './AboutSection.tsx';
import { AppearanceSection } from './AppearanceSection.tsx';
import { ChatSection } from './ChatSection.tsx';
import { DevicesSection } from './DevicesSection.tsx';
import { GeneralSection } from './GeneralSection.tsx';
import { KeyboardSection } from './KeyboardSection.tsx';
import type { MembersPort } from './members.ts';
import { MembersSection } from './MembersSection.tsx';
import type { PairingPort } from './pairing.ts';
import { ServerSection } from './ServerSection.tsx';
import { INDEX, isSection, ROWS, searchSettings, SECTIONS, targetOf, visibleNav, type SettingEntry, type SettingsLink, type SettingsSection } from './settings-index.ts';
import { SettingRow } from './SettingRow.tsx';
import { SettingsSearchField, SettingsSearchResults } from './SettingsNav.tsx';
import type { VaultPort } from './vault.ts';
import { VaultSection } from './VaultSection.tsx';

const FLASH_MS = 1_000;
/** A row's tab stop: for a segmented control, the checked segment. */
const TAB_STOP = ':is(input, textarea, select, button):not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])';

export interface SettingsModalProps {
  /** Where Settings opens; mount a new modal to open another link. */
  readonly link: SettingsLink;
  readonly onClose: () => void;
  readonly appearance: AppearanceModel;
  readonly chatPrefs: ChatPrefsModel;
  readonly info: AppInfo | null;
  readonly updates: UpdatesModel;
  readonly bridge: Pick<MorrowbotBridge, 'loginItem' | 'setOpenAtLogin' | 'revealPath' | 'resetPlan' | 'runReset'>;
  /** Settings › Providers, from `features/providers` (wired in by `app/`): opened at `initial`, naming its selection for the breadcrumb. */
  readonly providers: (slot: { readonly initial: string | null; readonly onTrail: (name: string | null) => void }) => ComponentChildren;
  /** Settings › Usage, composed by the app from the usage feature. */
  readonly usage: ComponentChildren;
  /** The host's pairing calls, for Settings › Devices. */
  readonly pairing: PairingPort;
  /** The host's member calls, for Settings › Members. */
  readonly members: MembersPort;
  /** The host's vault calls, for Settings › Vault. */
  readonly vault: VaultPort;
  /** Which server this app uses, for Settings › Server. */
  readonly server: Exclude<ServerMode, { kind: 'choosing' }>;
  /** Switches the server; answers a problem to show, or null once MorrowBot reopens. */
  readonly chooseServer: (request: ServerRequest) => Promise<string | null>;
  /** Sections left out of the nav and search (`hiddenSections`). */
  readonly hidden: ReadonlySet<SettingsSection>;
}

/** A section's own header row, so search finds the section. */
const Intro = ({ entry }: { readonly entry: SettingEntry }) => <SettingRow entry={entry}>{null}</SettingRow>;

/** Scrolls a row into view, moves focus to its control and flashes it; returns what ends the flash early. */
function reveal(body: HTMLElement, rowId: string, reducedMotion: boolean): (() => void) | undefined {
  const row = body.querySelector<HTMLElement>(`[data-setting="${CSS.escape(rowId)}"]`);
  if (row === null) return undefined;
  const control = row.querySelector<HTMLElement>(TAB_STOP);
  if (control === null) row.tabIndex = -1;
  (control ?? row).focus({ preventScroll: true });
  row.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'instant' : 'smooth' });
  row.classList.add('flash');
  const unflash = (): void => {
    row.classList.remove('flash');
  };
  const timer = window.setTimeout(unflash, FLASH_MS);
  return () => {
    window.clearTimeout(timer);
    unflash();
  };
}

/** App settings (⌘,) in the shared Settings shell, with `/` search over every row (spec §6). */
export function SettingsModal(props: SettingsModalProps) {
  const appearance = useStore(props.appearance.state);
  const chatPrefs = useStore(props.chatPrefs.state);
  const update = useStore(props.updates.status);
  const [start] = useState(() => {
    const target = targetOf(props.link);
    return props.hidden.has(target.section) ? targetOf('general') : target;
  });
  const [section, setSection] = useState<SettingsSection>(start.section);
  const [query, setQuery] = useState('');
  const [focusRow, setFocusRow] = useState<{ readonly id: string } | null>(start.row === null ? null : { id: start.row });
  const [trail, setTrail] = useState<string | null>(null);
  const onTrail = useCallback((name: string | null) => {
    setTrail(name);
  }, []);
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const searching = query.trim() !== '';
  const groups = searchSettings(query, INDEX.filter((entry) => !props.hidden.has(entry.section)));

  useLayoutEffect(() => {
    if (focusRow === null || body.current === null) return;
    return reveal(body.current, focusRow.id, appearance.reducedMotion);
  }, [focusRow]);

  const sectionView = () => {
    switch (section) {
      case 'general':
        return <GeneralSection bridge={props.bridge} />;
      case 'appearance':
        return <AppearanceSection appearance={appearance} onChange={props.appearance.set} />;
      case 'chat':
        return <ChatSection prefs={chatPrefs} onChange={props.chatPrefs.set} platform={PLATFORM} />;
      case 'keyboard':
        return <KeyboardSection platform={PLATFORM} sendWith={chatPrefs.sendWith} />;
      case 'providers':
        return (
          <>
            <Intro entry={ROWS.providers} />
            {props.providers({ initial: start.section === 'providers' ? start.item : null, onTrail })}
          </>
        );
      case 'vault':
        return <VaultSection port={props.vault} />;
      case 'usage':
        return props.usage;
      case 'server':
        return <ServerSection server={props.server} onChoose={props.chooseServer} />;
      case 'members':
        return <MembersSection port={props.members} />;
      case 'devices':
        return <DevicesSection pairing={props.pairing} />;
      case 'about':
        return (
          <AboutSection
            info={props.info}
            update={update}
            onRevealData={() => void props.bridge.revealPath({ kind: 'data-dir' })}
            onCheckForUpdates={props.updates.check}
            onRestartToUpdate={props.updates.restart}
            reset={props.bridge}
          />
        );
    }
  };

  const pick = (entry: SettingEntry): void => {
    setQuery('');
    setSection(entry.section);
    setFocusRow({ id: entry.id });
  };

  return (
    <SettingsShell
      label="Settings"
      groups={visibleNav(props.hidden)}
      selected={section}
      onSelect={(id) => {
        if (!isSection(id) || props.hidden.has(id)) return;
        setQuery('');
        setSection(id);
        setFocusRow(null);
      }}
      breadcrumb={['Settings', ...(searching ? ['Search'] : [SECTIONS[section].title, ...(section === 'providers' && trail !== null ? [trail] : [])])]}
      onClose={props.onClose}
      search={{
        field: <SettingsSearchField input={input} results={results} query={query} first={groups[0]?.entries[0] ?? null} onQuery={setQuery} onPick={pick} />,
        focus: () => {
          input.current?.focus();
          input.current?.select();
        },
      }}
    >
      <div ref={body} class="settings-body">
        {searching ? (
          <SettingsSearchResults
            results={results}
            query={query}
            groups={groups}
            onPick={pick}
            onBack={() => {
              input.current?.focus();
            }}
            onClear={() => {
              setQuery('');
              input.current?.focus();
            }}
          />
        ) : (
          sectionView()
        )}
      </div>
    </SettingsShell>
  );
}
