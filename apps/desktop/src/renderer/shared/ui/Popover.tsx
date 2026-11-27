import type { ComponentChildren, RefObject } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { escapeStack } from '../escape-stack.ts';
import { placeFloating, type Align, type Side } from './place.ts';

const FOCUSABLE = 'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"]), [data-roving][tabindex]';

/** The first control in `root` to focus when a layer opens: an `[autofocus]` one, else the first focusable. */
export function firstFocusable(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>('[data-autofocus]') ?? root.querySelector<HTMLElement>(FOCUSABLE);
}

export interface PopoverProps {
  /** The trigger: the popover anchors to it, it stays a safe click target, and focus returns to it. */
  readonly anchor: RefObject<HTMLElement | null>;
  /** Opens at this window point (a right-click) instead of beside the anchor. */
  readonly at?: { readonly x: number; readonly y: number } | undefined;
  readonly label: string;
  readonly onClose: () => void;
  readonly side?: Side;
  readonly align?: Align;
  /** Width in px; the content decides when absent. */
  readonly width?: number;
  readonly role?: 'dialog' | 'menu' | 'listbox';
  readonly class?: string;
  readonly onKeyDown?: (event: KeyboardEvent) => void;
  readonly children: ComponentChildren;
}

/**
 * A floating layer in the top layer (spec §1.4): anchored 8px from its trigger, flipped and clamped,
 * on the Escape stack. Mount it to open it; it focuses its first control and returns focus on close.
 */
export function Popover(props: PopoverProps) {
  const panel = useRef<HTMLDivElement>(null);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;
  useLayoutEffect(() => {
    const element = panel.current;
    const trigger = props.anchor.current;
    if (element === null) return;
    element.showPopover();
    const place = (): void => {
      const box = props.at === undefined ? (trigger ?? element).getBoundingClientRect() : { top: props.at.y, left: props.at.x, width: 0, height: 0 };
      const placed = placeFloating(box, element.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }, props.side ?? 'bottom', props.align ?? 'start');
      element.style.top = `${String(placed.top)}px`;
      element.style.left = `${String(placed.left)}px`;
      element.dataset.side = placed.side;
    };
    place();
    window.addEventListener('resize', place);
    const resized = new ResizeObserver(place);
    resized.observe(element);
    const removeLayer = escapeStack.push({
      close: () => {
        onClose.current();
      },
      returnFocus: trigger,
      contains: (target) => target instanceof Node && (element.contains(target) || trigger?.contains(target) === true),
    });
    (firstFocusable(element) ?? element).focus();
    return () => {
      window.removeEventListener('resize', place);
      resized.disconnect();
      removeLayer();
    };
  }, []);
  return (
    <div
      ref={panel}
      popover="manual"
      role={props.role ?? 'dialog'}
      aria-label={props.label}
      tabIndex={-1}
      class={`popover ${props.class ?? ''}`}
      style={props.width === undefined ? undefined : { width: `${String(props.width)}px` }}
      onKeyDown={props.onKeyDown}
    >
      {props.children}
    </div>
  );
}
