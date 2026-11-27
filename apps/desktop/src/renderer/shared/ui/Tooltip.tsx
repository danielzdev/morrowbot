import type { ComponentChildren, Ref } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ariaShortcut, PLATFORM, shortcutLabel, type ShortcutId } from '../keys.ts';
import { Icon, type IconName } from './Icon.tsx';
import { placeFloating, type Side } from './place.ts';

const HOVER_DELAY_MS = 500;

function Bubble(props: { readonly anchor: HTMLElement; readonly label: string; readonly shortcut: ShortcutId | undefined; readonly side: Side }) {
  const bubble = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = bubble.current;
    if (element === null) return;
    element.showPopover();
    const target = props.anchor.firstElementChild ?? props.anchor;
    const place = placeFloating(target.getBoundingClientRect(), element.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }, props.side, 'center');
    element.style.top = `${String(place.top)}px`;
    element.style.left = `${String(place.left)}px`;
  }, []);
  return (
    <div ref={bubble} popover="manual" role="tooltip" class="tooltip">
      {props.label}
      {props.shortcut !== undefined && <kbd>{shortcutLabel(props.shortcut, PLATFORM)}</kbd>}
    </div>
  );
}

/** Shows `label` (and its shortcut) after a hover delay, or at once on keyboard focus. Never the only carrier of information. */
export function Tooltip(props: { readonly label: string; readonly shortcut?: ShortcutId; readonly side?: Side; readonly children: ComponentChildren }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [shown, setShown] = useState(false);
  useEffect(() => () => {
    clearTimeout(timer.current);
  }, []);
  const show = (delay: number): void => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setShown(true);
    }, delay);
  };
  const hide = (): void => {
    clearTimeout(timer.current);
    setShown(false);
  };
  return (
    <span
      ref={anchor}
      class="tooltip-anchor"
      onPointerEnter={() => {
        show(HOVER_DELAY_MS);
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocusIn={(event) => {
        if (event.target instanceof Element && event.target.matches(':focus-visible')) show(0);
      }}
      onFocusOut={hide}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && shown) hide();
      }}
    >
      {props.children}
      {shown && anchor.current !== null && <Bubble anchor={anchor.current} label={props.label} shortcut={props.shortcut} side={props.side ?? 'bottom'} />}
    </span>
  );
}

/** An icon-only button: its label is both the accessible name and the tooltip, with the shortcut beside it. */
export function IconButton(props: {
  readonly icon: IconName;
  readonly label: string;
  readonly onClick: (event: MouseEvent) => void;
  readonly shortcut?: ShortcutId;
  readonly side?: Side;
  readonly buttonRef?: Ref<HTMLButtonElement>;
  readonly expanded?: boolean;
  readonly popup?: 'menu' | 'dialog';
  readonly class?: string;
  readonly tabIndex?: number;
}) {
  return (
    <Tooltip label={props.label} {...(props.shortcut === undefined ? {} : { shortcut: props.shortcut })} side={props.side ?? 'bottom'}>
      <button
        {...(props.buttonRef === undefined ? {} : { ref: props.buttonRef })}
        type="button"
        class={`icon-btn ${props.class ?? ''}`}
        aria-label={props.label}
        aria-keyshortcuts={props.shortcut === undefined ? undefined : ariaShortcut(props.shortcut, PLATFORM)}
        aria-expanded={props.expanded}
        aria-haspopup={props.popup}
        tabIndex={props.tabIndex}
        onClick={props.onClick}
      >
        <Icon name={props.icon} />
      </button>
    </Tooltip>
  );
}
