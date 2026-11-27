import type { ShortcutId } from '../../shared/keys.ts';
import { Icon } from '../../shared/ui/Icon.tsx';
import { IconButton, Tooltip } from '../../shared/ui/Tooltip.tsx';
import type { SidebarMode } from './Sidebar.tsx';

/** The sidebar's draggable top bar (collapse and New agent), or the rail's tool column. */
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
      <IconButton icon="plus" label="New agent" shortcut="new-agent" onClick={props.onNewAgent} />
    </div>
  );
}

/** Settings and Plugins; Plugins carries a dot and a spoken label when a plugin needs attention. */
export function SidebarBottom(props: {
  readonly rail: boolean;
  readonly plugins: { readonly tone: 'warn' | 'danger'; readonly label: string } | null;
  readonly onSettings: () => void;
  readonly onPlugins: () => void;
}) {
  return (
    <div class="sidebar-bottom">
      <BottomButton rail={props.rail} icon="settings" label="Settings" shortcut="settings" onClick={props.onSettings} />
      <BottomButton rail={props.rail} icon="plugins" label={props.plugins?.label ?? 'Plugins'} text="Plugins" dot={props.plugins?.tone ?? null} onClick={props.onPlugins} />
    </div>
  );
}

function BottomButton(props: {
  readonly rail: boolean;
  readonly icon: 'settings' | 'plugins';
  readonly label: string;
  readonly text?: string;
  readonly shortcut?: ShortcutId;
  readonly dot?: 'warn' | 'danger' | null;
  readonly onClick: () => void;
}) {
  return (
    <Tooltip label={props.label} {...(props.shortcut === undefined ? {} : { shortcut: props.shortcut })} side={props.rail ? 'right' : 'top'}>
      <button type="button" class="bottom-btn" aria-label={props.label} onClick={props.onClick}>
        <Icon name={props.icon} />
        {!props.rail && <span>{props.text ?? props.label}</span>}
        {props.dot != null && <span class={`status-dot ${props.dot}`} aria-hidden="true" />}
      </button>
    </Tooltip>
  );
}
