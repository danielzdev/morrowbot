import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { z } from 'zod';
import { escapeStack } from '../../shared/escape-stack.ts';
import { readPref, writePref } from '../../shared/local-pref.ts';
import { ResizeHandle } from '../../shared/ui/ResizeHandle.tsx';
import { IconButton } from '../../shared/ui/Tooltip.tsx';
import type { InspectorFacts } from './inspector-facts.ts';
import { InspectorCards, type InspectorActions } from './InspectorCards.tsx';

/** Below this width the Inspector opens over the chat instead of beside it (spec §3.4). */
const OVERLAY = '(max-width: 1199px)';

/** Marks the button that toggles the Inspector, so pressing it does not count as a press outside the overlay. */
export const INSPECTOR_TOGGLE = 'data-inspector-toggle';

const WIDTH = { min: 260, max: 480, initial: 300 };
const Width = z.number().min(WIDTH.min).max(WIDTH.max);
const KEY = 'morrowbot.inspector-width';

function useOverlay(): boolean {
  const [overlay, setOverlay] = useState(() => window.matchMedia(OVERLAY).matches);
  useEffect(() => {
    const media = window.matchMedia(OVERLAY);
    const onChange = (): void => {
      setOverlay(media.matches);
    };
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, []);
  return overlay;
}

/**
 * The Agent Inspector (spec §3.4): a resizable drawer beside the chat, or a 300px one over it below
 * 1200px, where Esc and a press outside close it. Opening moves focus to its title; closing returns focus.
 */
export function Inspector(props: { readonly agentName: string; readonly facts: InspectorFacts; readonly actions: InspectorActions; readonly onClose: () => void }) {
  const overlay = useOverlay();
  const [width, setWidth] = useState(() => readPref(KEY, Width, WIDTH.initial));
  const panel = useRef<HTMLElement>(null);
  const close = useRef(props.onClose);
  close.current = props.onClose;
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = panel.current;
    element?.querySelector<HTMLElement>('.inspector-title')?.focus();
    return () => {
      const active = document.activeElement;
      const lost = active === null || active === document.body || element?.contains(active) === true;
      if (lost && opener?.isConnected === true) opener.focus();
    };
  }, []);
  useLayoutEffect(() => {
    const element = panel.current;
    if (!overlay || element === null) return;
    return escapeStack.push({
      close: () => {
        close.current();
      },
      returnFocus: null,
      contains: (target) => target instanceof Element && (element.contains(target) || target.closest(`[${INSPECTOR_TOGGLE}]`) !== null),
    });
  }, [overlay]);
  return (
    <>
      {overlay && <div class="scrim inspector-scrim" aria-hidden="true" />}
      <aside ref={panel} class={`inspector ${overlay ? 'overlay' : 'docked'}`} style={{ '--inspector-w': `${String(width)}px` }} aria-labelledby="inspector-title">
        {!overlay && (
          <ResizeHandle
            class="inspector-resizer"
            label="Resize inspector"
            edge="left"
            width={width}
            bounds={WIDTH}
            onResize={(next) => {
              setWidth(next);
              writePref(KEY, next);
            }}
          />
        )}
        <header class="inspector-header">
          <h2 id="inspector-title" class="inspector-title" tabIndex={-1}>
            <span class="visually-hidden">{props.agentName} · </span>Inspector
          </h2>
          <span class="spacer" />
          <IconButton icon="close" label="Close inspector" shortcut="inspector" onClick={props.onClose} />
        </header>
        <div class="inspector-body">
          <InspectorCards facts={props.facts} actions={props.actions} />
        </div>
      </aside>
    </>
  );
}
