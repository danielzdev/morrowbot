import type { PluginEntry } from '@morrowbot/contracts';
import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { z } from 'zod';
import type { MorrowbotBridge } from '../../bridge.ts';
import { escapeStack } from '../../shared/escape-stack.ts';
import { isSearchPress } from '../../shared/keys.ts';
import { readPref, writePref } from '../../shared/local-pref.ts';
import { displayPath, redact, type AppInfo } from '../../shared/privacy.ts';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { Icon } from '../../shared/ui/Icon.tsx';
import { MenuButton } from '../../shared/ui/Menu.tsx';
import { isTextField } from '../../shared/ui/SettingsShell.tsx';
import { useStore } from '../../shared/use-store.ts';
import { MarketplaceTab, type CatalogFilter } from './MarketplaceTab.tsx';
import { pluginItems, PluginsTab } from './PluginsTab.tsx';
import { isListedPlugin } from './plugin-health.ts';
import type { PluginsModel } from './plugins-model.ts';
import { SafeModeBanner, SafeModeDialog } from './SafeMode.tsx';

const Tab = z.enum(['plugins', 'connectors', 'marketplace']);
type Tab = z.infer<typeof Tab>;
const TAB_KEY = 'morrowbot.extensions.tab';
const TAB_LABEL: Readonly<Record<Tab, string>> = { plugins: 'Plugins', connectors: 'Connectors', marketplace: 'Marketplace' };

/** What the Connectors tab gets from Extensions. */
export interface ConnectorsSlot {
  /** The search, which filters every tab. */
  readonly query: string;
  readonly onDirty: (dirty: boolean) => void;
  /** Runs an action after the "Discard changes?" check. */
  readonly guard: (action: () => void) => void;
  /** Opens the Marketplace on connectors. */
  readonly onBrowse: () => void;
}

/** Where a jump lands: the Connectors tab (then `arrive`), or a plugin's page in Plugins. */
export type ExtensionsJumpTo = { readonly kind: 'connectors'; readonly arrive: () => void } | { readonly kind: 'plugin'; readonly pluginId: string };

export interface ExtensionsViewProps {
  readonly model: PluginsModel;
  readonly info: AppInfo | null;
  /** The Connectors tab, which the connectors feature draws, and how many connectors match the search. */
  readonly connectors: { readonly count: (query: string) => number | null; readonly tab: (slot: ConnectorsSlot) => ComponentChildren };
  /** Another screen sent the user here: each new `id` shows that place, after the dirty check. */
  readonly jump: { readonly id: number; readonly to: ExtensionsJumpTo } | null;
  readonly bridge: Pick<MorrowbotBridge, 'revealPath' | 'relaunch'>;
  /** "Configure in Providers →" for a plugin that adds a community provider. */
  readonly onOpenProvider: (providerId: string) => void;
  /** Hands the dirty check to the app while Extensions is open, so leaving by the sidebar asks too; null on close. */
  readonly onLeaveCheck: (check: ((action: () => void) => void) | null) => void;
  /** Esc: back to chat, after the dirty check. */
  readonly onExit: () => void;
}

/** Extensions (⇧⌘X, spec IA §3): Plugins | Connectors | Marketplace, `/` search over all three, and safe mode. */
export function ExtensionsView(props: ExtensionsViewProps) {
  const { model, info } = props;
  const loaded = useStore(model.list);
  const activity = useStore(model.activity);
  const [savedTab, setSavedTab] = useState<Tab | null>(() => readPref(TAB_KEY, Tab.nullable(), null));
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogFilter>('all');
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [safeDialog, setSafeDialog] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const exit = useRef(props.onExit);
  exit.current = props.onExit;
  const guarded = useRef<(action: () => void) => void>(() => undefined);
  guarded.current = (action) => {
    if (dirty) setPending(() => action);
    else action();
  };

  useEffect(() => {
    void model.load();
  }, [model]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || document.querySelector('dialog[open]') !== null) return;
      if (event.key === 'Escape' && escapeStack.depth === 0) {
        event.preventDefault();
        guarded.current(() => { exit.current(); });
      } else if (isSearchPress(event, isTextField(event.target))) {
        event.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  const onDirty = useCallback((next: boolean) => {
    setDirty(next);
  }, []);
  const guard = useCallback((action: () => void) => {
    guarded.current(action);
  }, []);
  const { onLeaveCheck } = props;
  useEffect(() => {
    onLeaveCheck(guard);
    return () => {
      onLeaveCheck(null);
    };
  }, [guard, onLeaveCheck]);
  const jump = useRef(props.jump);
  jump.current = props.jump;
  const jumpId = props.jump?.id;
  useEffect(() => {
    const to = jump.current;
    if (to === null) return;
    guarded.current(() => {
      setQuery('');
      const { to: place } = to;
      switch (place.kind) {
        case 'connectors':
          setSavedTab('connectors');
          writePref(TAB_KEY, 'connectors');
          place.arrive();
          return;
        case 'plugin':
          setSavedTab('plugins');
          writePref(TAB_KEY, 'plugins');
          setSelectedKey(`plugin:${place.pluginId}`);
      }
    });
  }, [jumpId]);

  if (info === null || loaded.kind === 'loading') return <p class="muted page-pad">Loading extensions…</p>;
  if (loaded.kind === 'failed') {
    return (
      <div class="banner error page-pad" role="alert">
        <span>MorrowBot couldn't read its plugin folders. {redact(loaded.message, info)}</span>
        <button type="button" class="btn secondary" onClick={() => void model.load()}>
          Try again
        </button>
      </div>
    );
  }
  const list = loaded.value;
  const safe = (text: string): string => redact(text, info);
  const listed = list.plugins.filter(isListedPlugin);
  const tab: Tab = savedTab ?? (listed.length === 0 && list.problems.length === 0 ? 'marketplace' : 'plugins');
  const items = pluginItems(list, query);
  const selected = items.find((item) => item.key === selectedKey) ?? items[0];
  const searching = query.trim() !== '';
  const openFolder = (): void => void props.bridge.revealPath({ kind: 'plugins-dir' });
  const rescan = (): void => void model.rescan();
  const showTab = (next: Tab): void => {
    guarded.current(() => {
      setSavedTab(next);
      writePref(TAB_KEY, next);
    });
  };
  const counts: Readonly<Record<Tab, number | null>> = { plugins: items.length, connectors: props.connectors.count(query), marketplace: null };
  const actionsFor = (entry: PluginEntry) => {
    const id = entry.manifest.id;
    return {
      onEnabled: (enabled: boolean) => void model.setEnabled(id, enabled),
      onRestart: () => void model.restart(id),
      onSaveConfig: (config: PluginEntry['config']) => void model.setConfig(id, config),
      onOpenFolder: openFolder,
      onOpenProvider: () => { guarded.current(() => { props.onOpenProvider(id); }); },
      onDirty,
    };
  };

  return (
    <div class="extensions">
      <div class="extensions-toolbar">
        <div class="search-field extensions-search">
          <Icon name="search" />
          <input
            ref={search}
            type="text"
            role="searchbox"
            aria-label="Search extensions"
            aria-keyshortcuts="/"
            placeholder="Search extensions…"
            spellcheck={false}
            value={query}
            onInput={(event) => { setQuery(event.currentTarget.value); }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query !== '') {
                event.preventDefault();
                setQuery('');
              }
            }}
          />
          {query === '' && <kbd aria-hidden="true">/</kbd>}
        </div>
        <MenuButton
          icon="more"
          label="Extension actions"
          items={() => [
            { kind: 'action', id: 'rescan', label: activity.rescan.kind === 'running' ? 'Rescanning…' : 'Rescan', onSelect: rescan },
            { kind: 'action', id: 'folder', label: 'Open plugins folder', onSelect: openFolder },
            { kind: 'separator', id: 'sep' },
            { kind: 'action', id: 'safe-mode', label: list.safeMode ? 'Restart normally…' : 'Safe mode…', onSelect: () => { setSafeDialog(true); } },
          ]}
        />
      </div>
      <div class="extensions-tabs" role="tablist" aria-label="Extensions">
        {Tab.options.map((each) => (
          <button key={each} type="button" role="tab" id={`ext-tab-${each}`} aria-selected={each === tab} aria-controls="ext-panel" class="ext-tab" onClick={() => { showTab(each); }}>
            {TAB_LABEL[each]}
            {counts[each] !== null && <span class="count">{counts[each]}</span>}
          </button>
        ))}
      </div>
      {list.safeMode && <SafeModeBanner focus onRestartNormally={() => { setSafeDialog(true); }} />}
      {activity.rescan.kind === 'failed' && (
        <div class="banner error" role="alert">
          <span>Rescan didn't finish: {safe(activity.rescan.message)}</span>
          <button type="button" class="btn secondary" onClick={rescan}>
            Try again
          </button>
        </div>
      )}
      <div id="ext-panel" role="tabpanel" aria-labelledby={`ext-tab-${tab}`} class="extensions-panel">
        {tab === 'plugins' && (
          <PluginsTab
            list={list}
            items={items}
            activity={activity}
            selected={selected}
            searching={searching}
            pluginsDir={displayPath(list.pluginsDir, info)}
            redact={safe}
            onSelect={(key) => { guarded.current(() => { setSelectedKey(key); }); }}
            onRescan={rescan}
            onOpenFolder={openFolder}
            onBrowse={() => { setCatalog('plugins'); showTab('marketplace'); }}
            actionsFor={actionsFor}
          />
        )}
        {tab === 'connectors' && props.connectors.tab({ query, onDirty, guard, onBrowse: () => { setCatalog('connectors'); showTab('marketplace'); } })}
        {tab === 'marketplace' && (
          <MarketplaceTab
            filter={catalog}
            installed={listed.filter((entry) => entry.manifest.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))}
            rescanning={activity.rescan.kind === 'running'}
            onFilter={setCatalog}
            onShowInstalled={(id) => {
              setSelectedKey(`plugin:${id}`);
              showTab('plugins');
            }}
            onOpenFolder={openFolder}
            onRescan={rescan}
          />
        )}
      </div>
      {pending !== null && (
        <ConfirmDialog
          title="Discard changes?"
          body="Your unsaved settings will be lost."
          confirmLabel="Discard"
          tone="danger"
          onCancel={() => { setPending(null); }}
          onConfirm={() => {
            setDirty(false);
            setPending(null);
            pending();
          }}
        />
      )}
      {safeDialog && <SafeModeDialog safeMode={list.safeMode} onCancel={() => { setSafeDialog(false); }} onRestart={(next) => void props.bridge.relaunch({ safeMode: next })} />}
    </div>
  );
}
