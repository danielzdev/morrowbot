import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { MorrowbotBridge } from '../../bridge.ts';
import type { AppearanceModel } from '../../shared/appearance.ts';
import type { ChatPrefsModel } from '../../shared/chat-prefs.ts';
import { PLATFORM } from '../../shared/keys.ts';
import type { AppInfo } from '../../shared/privacy.ts';
import { SettingsShell } from '../../shared/ui/SettingsShell.tsx';
import { useStore } from '../../shared/use-store.ts';
import { AboutSection } from './AboutSection.tsx';
import { AppearanceSection } from './AppearanceSection.tsx';
import { ChatSection } from './ChatSection.tsx';
import { GeneralSection } from './GeneralSection.tsx';
import { KeyboardSection } from './KeyboardSection.tsx';
import { isSection, NAV, searchSettings, SECTIONS, targetOf, type SettingEntry, type SettingsLink, type SettingsSection } from './settings-index.ts';
import { SettingsSearchField, SettingsSearchResults } from './SettingsNav.tsx';

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
  readonly bridge: Pick<MorrowbotBridge, 'loginItem' | 'setOpenAtLogin' | 'revealPath'>;
}

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
  const [start] = useState(() => targetOf(props.link));
  const [section, setSection] = useState<SettingsSection>(start.section);
  const [query, setQuery] = useState('');
  const [focusRow, setFocusRow] = useState<{ readonly id: string } | null>(start.row === null ? null : { id: start.row });
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const searching = query.trim() !== '';
  const groups = searchSettings(query);

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
      case 'about':
        return <AboutSection info={props.info} onRevealData={() => void props.bridge.revealPath({ kind: 'data-dir' })} />;
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
      groups={NAV}
      selected={section}
      onSelect={(id) => {
        if (!isSection(id)) return;
        setQuery('');
        setSection(id);
        setFocusRow(null);
      }}
      breadcrumb={['Settings', searching ? 'Search' : SECTIONS[section].title]}
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
            key={query}
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
