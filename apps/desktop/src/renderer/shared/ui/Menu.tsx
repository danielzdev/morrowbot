import type { RefObject } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { PLATFORM, shortcutLabel, type ShortcutId } from '../keys.ts';
import { handleRovingKey } from '../roving.ts';
import { Icon, type IconName } from './Icon.tsx';
import type { Align, Side } from './place.ts';
import { Popover } from './Popover.tsx';
import { IconButton } from './Tooltip.tsx';

export type MenuItem =
  | {
      readonly kind: 'action';
      readonly id: string;
      readonly label: string;
      readonly onSelect: () => void;
      readonly icon?: IconName;
      readonly shortcut?: ShortcutId;
      readonly danger?: boolean;
    }
  | { readonly kind: 'separator'; readonly id: string };

/** A menu of actions in a popover: ↑/↓/Home/End and type-ahead move, Enter or Space runs the item. */
export function Menu(props: {
  readonly anchor: RefObject<HTMLElement | null>;
  readonly label: string;
  readonly items: readonly MenuItem[];
  readonly onClose: () => void;
  readonly side?: Side;
  readonly align?: Align;
}) {
  const list = useRef<HTMLDivElement>(null);
  let first = true;
  return (
    <Popover
      anchor={props.anchor}
      label={props.label}
      role="menu"
      class="menu"
      onClose={props.onClose}
      side={props.side ?? 'bottom'}
      align={props.align ?? 'end'}
      onKeyDown={(event) => {
        if (list.current !== null) handleRovingKey(event, list.current);
        if (event.key === 'Tab') {
          event.preventDefault();
          props.onClose();
        }
      }}
    >
      <div ref={list} class="menu-list">
        {props.items.map((item) => {
          switch (item.kind) {
            case 'separator':
              return <div key={item.id} role="separator" class="menu-separator" />;
            case 'action': {
              const tabIndex = first ? 0 : -1;
              first = false;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  data-roving={item.label}
                  tabIndex={tabIndex}
                  class={`menu-item ${item.danger === true ? 'danger' : ''}`}
                  onClick={() => {
                    props.onClose();
                    item.onSelect();
                  }}
                >
                  <span class="menu-icon">{item.icon !== undefined && <Icon name={item.icon} />}</span>
                  <span class="menu-label">{item.label}</span>
                  {item.shortcut !== undefined && <kbd>{shortcutLabel(item.shortcut, PLATFORM)}</kbd>}
                </button>
              );
            }
          }
        })}
      </div>
    </Popover>
  );
}

/** An icon button that opens a menu below it. */
export function MenuButton(props: {
  readonly icon: IconName;
  readonly label: string;
  readonly items: () => readonly MenuItem[];
  readonly class?: string;
  readonly tabIndex?: number;
  readonly align?: Align;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        icon={props.icon}
        label={props.label}
        buttonRef={trigger}
        popup="menu"
        expanded={open}
        {...(props.class === undefined ? {} : { class: props.class })}
        {...(props.tabIndex === undefined ? {} : { tabIndex: props.tabIndex })}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(!open);
        }}
      />
      {open && (
        <Menu
          anchor={trigger}
          label={props.label}
          items={props.items()}
          align={props.align ?? 'end'}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
