import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { escapeStack } from '../escape-stack.ts';
import { firstFocusable } from './Popover.tsx';

/**
 * A modal dialog over a scrim (spec §1.4). Mount it to open it: the rest of the window goes inert,
 * focus stays inside, Esc or a press on the scrim calls `onClose`, and focus returns to what had it.
 */
export function Modal(props: {
  readonly label: string;
  readonly onClose: () => void;
  readonly class?: string;
  readonly role?: 'dialog' | 'alertdialog';
  readonly children: ComponentChildren;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;
  const unmounting = useRef(false);
  useLayoutEffect(() => {
    const element = dialog.current;
    const inner = panel.current;
    if (element === null || inner === null) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    const removeLayer = escapeStack.push({
      close: () => {
        onClose.current();
      },
      returnFocus: null,
      contains: (target) => target instanceof Node && inner.contains(target),
    });
    (firstFocusable(inner) ?? inner).focus();
    return () => {
      unmounting.current = true;
      removeLayer();
      element.close();
      if (opener?.isConnected === true) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      class={`modal ${props.class ?? ''}`}
      role={props.role}
      aria-label={props.label}
      onCancel={(event) => {
        event.preventDefault();
      }}
      onClose={() => {
        if (!unmounting.current) onClose.current();
      }}
    >
      <div ref={panel} class="modal-panel" tabIndex={-1}>
        {props.children}
      </div>
    </dialog>
  );
}
