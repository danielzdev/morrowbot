import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import { handleRovingKey } from '../roving.ts';
import { Icon, type IconName } from './Icon.tsx';
import { Modal } from './Modal.tsx';
import { IconButton } from './Tooltip.tsx';

export interface SettingsNavItem {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  /** A section with unsaved changes shows a dot. */
  readonly dirty?: boolean;
}

export interface SettingsNavGroup {
  readonly label: string | null;
  readonly items: readonly SettingsNavItem[];
}

/**
 * The Settings modal frame (spec §6), shared by app Settings and Agent Settings: a grouped nav on
 * the left, a breadcrumb, and a scrolling detail pane. Esc or × closes it.
 */
export function SettingsShell(props: {
  readonly label: string;
  readonly groups: readonly SettingsNavGroup[];
  readonly selected: string;
  readonly onSelect: (id: string) => void;
  readonly breadcrumb: readonly string[];
  readonly onClose: () => void;
  readonly children: ComponentChildren;
}) {
  const nav = useRef<HTMLElement>(null);
  return (
    <Modal label={props.label} class="settings-modal" onClose={props.onClose}>
      <div class="settings-shell">
        <nav
          ref={nav}
          class="settings-nav"
          aria-label={`${props.label} sections`}
          onKeyDown={(event) => {
            if (nav.current !== null) handleRovingKey(event, nav.current);
          }}
        >
          {props.groups.map((group, index) => (
            <div key={group.label ?? index} class="settings-nav-group" role="group" aria-label={group.label ?? undefined}>
              {group.label !== null && <div class="kicker">{group.label}</div>}
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-roving={item.label}
                  data-autofocus={item.id === props.selected ? true : undefined}
                  tabIndex={item.id === props.selected ? 0 : -1}
                  aria-current={item.id === props.selected ? 'page' : undefined}
                  class="settings-nav-item"
                  onClick={() => {
                    props.onSelect(item.id);
                  }}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                  {item.dirty === true && <span class="dot accent" aria-label="Unsaved changes" />}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <section class="settings-main" aria-label={props.breadcrumb.join(' / ')}>
          <header class="settings-header">
            <div class="breadcrumb">
              {props.breadcrumb.map((part, index) => (
                <span key={part} class={index === props.breadcrumb.length - 1 ? 'current' : ''}>
                  {part}
                </span>
              ))}
            </div>
            <IconButton icon="close" label="Close" onClick={props.onClose} />
          </header>
          <div class="settings-pane">{props.children}</div>
        </section>
      </div>
    </Modal>
  );
}
