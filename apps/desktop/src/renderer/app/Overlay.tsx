import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { escapeStack } from '../shared/escape-stack.ts';

/** The sidebar as a dismissible drawer below 760px: on the Escape stack, closed by a press outside it. */
export function Overlay(props: { readonly onClose: () => void; readonly children: ComponentChildren }) {
  const drawer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = drawer.current;
    if (element === null) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.querySelector<HTMLElement>('.agent-main[tabindex="0"]')?.focus();
    return escapeStack.push({ close: props.onClose, returnFocus: opener, contains: (target) => target instanceof Node && element.contains(target) });
  }, []);
  return (
    <>
      <div class="scrim" aria-hidden="true" />
      <div ref={drawer} class="sidebar-overlay">
        {props.children}
      </div>
    </>
  );
}
