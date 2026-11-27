import type { RefObject } from 'preact';
import { ariaShortcut, PLATFORM, shortcutLabel, type ShortcutId } from '../../shared/keys.ts';
import { Icon } from '../../shared/ui/Icon.tsx';
import { IconButton, Tooltip } from '../../shared/ui/Tooltip.tsx';
import type { SidebarMode } from './Sidebar.tsx';

/** The sidebar's draggable top bar with the collapse button, or the rail's tool column. */
export function SidebarTop(props: { readonly mode: SidebarMode; readonly onToggle: () => void; readonly onNewAgent: () => void }) {
  if (props.mode === 'rail') {
    return (
      <>
        <div class="sidebar-top drag" />
        <div class="rail-tools">
          <IconButton icon="sidebar" label="Expand sidebar" shortcut="toggle-sidebar" side="right" onClick={props.onToggle} />
          <IconButton icon="plus" label="New agent" shortcut="new-agent" side="right" onClick={props.onNewAgent} />
        </div>
      </>
    );
  }
  return (
    <div class="sidebar-top drag">
      <span class="spacer" />
      <IconButton icon="sidebar" label={props.mode === 'overlay' ? 'Close sidebar' : 'Collapse sidebar'} shortcut="toggle-sidebar" onClick={props.onToggle} />
    </div>
  );
}

/** Search across agents (⇧⌘F) and the round New agent button. ↓ moves into the list; Esc clears. */
export function SidebarSearch(props: {
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onDown: () => void;
  readonly onNewAgent: () => void;
}) {
  return (
    <div class="sidebar-search">
      <label class="search-field">
        <Icon name="search" />
        <input
          ref={props.inputRef}
          type="search"
          placeholder="Search"
          aria-label={`Search agents (${shortcutLabel('filter-agents', PLATFORM)})`}
          aria-keyshortcuts={ariaShortcut('filter-agents', PLATFORM)}
          value={props.value}
          onInput={(event) => {
            props.onChange(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && props.value !== '') {
              event.stopPropagation();
              props.onChange('');
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              props.onDown();
            }
          }}
        />
      </label>
      <IconButton icon="plus" label="New agent" shortcut="new-agent" class="round-btn" onClick={props.onNewAgent} />
    </div>
  );
}

/** Extensions (⇧⌘X) above the hairline, carrying the dot and its spoken words when a plugin needs attention; Settings below. */
export function SidebarBottom(props: {
  readonly rail: boolean;
  readonly alert: { readonly tone: 'warn' | 'danger'; readonly label: string } | null;
  readonly onSettings: () => void;
  readonly onUsage: () => void;
  readonly onExtensions: () => void;
}) {
  return (
    <>
      <div class="sidebar-extensions">
        <BottomButton rail={props.rail} icon="plugins" label={props.alert?.label ?? 'Extensions'} text="Extensions" shortcut="extensions" dot={props.alert?.tone ?? null} onClick={props.onExtensions} />
      </div>
      <div class="sidebar-bottom">
        <BottomButton rail={props.rail} icon="settings" label="Settings" shortcut="settings" onClick={props.onSettings} />
        <BottomButton rail={props.rail} icon="gauge" label="Usage" shortcut="usage" onClick={props.onUsage} />
      </div>
    </>
  );
}

function BottomButton(props: {
  readonly rail: boolean;
  readonly icon: 'settings' | 'gauge' | 'plugins';
  readonly label: string;
  readonly text?: string;
  readonly shortcut: ShortcutId;
  readonly dot?: 'warn' | 'danger' | null;
  readonly onClick: () => void;
}) {
  return (
    <Tooltip label={props.label} shortcut={props.shortcut} side={props.rail ? 'right' : 'top'}>
      <button type="button" class="bottom-btn" aria-label={props.label} aria-keyshortcuts={ariaShortcut(props.shortcut, PLATFORM)} onClick={props.onClick}>
        <Icon name={props.icon} />
        {!props.rail && <span>{props.text ?? props.label}</span>}
        {props.dot != null && <span class={`status-dot ${props.dot}`} aria-hidden="true" />}
      </button>
    </Tooltip>
  );
}
