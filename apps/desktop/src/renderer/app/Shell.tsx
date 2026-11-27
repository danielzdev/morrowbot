import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { z } from 'zod';
import type { SidebarMode } from '../features/agents/index.ts';
import { escapeStack } from '../shared/escape-stack.ts';
import { PLATFORM, shortcutOf, type ShortcutId } from '../shared/keys.ts';
import { readPref, writePref } from '../shared/local-pref.ts';
import type { Chrome } from './ChatPane.tsx';
import { Overlay } from './Overlay.tsx';

const NARROW = '(max-width: 759px)';
const WIDTH = { min: 260, max: 380, initial: 300 };
const Layout = z.strictObject({ collapsed: z.boolean(), width: z.number().min(WIDTH.min).max(WIDTH.max) });
const KEY = 'morrowbot.layout';

export interface SidebarControls {
  readonly toggle: () => void;
  /** Closes the overlay sidebar after a pick; does nothing when it is docked. */
  readonly dismiss: () => void;
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const media = window.matchMedia(NARROW);
    const onChange = (): void => {
      setNarrow(media.matches);
    };
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, []);
  return narrow;
}

/**
 * The window frame (spec §3): sidebar (docked, 56px rail, or an overlay below 760px), the main
 * pane, the global shortcuts and the Escape stack's key and pointer feeds.
 */
export function Shell(props: {
  readonly sidebar: (mode: SidebarMode, controls: SidebarControls) => ComponentChildren;
  readonly main: (chrome: Chrome) => ComponentChildren;
  readonly onShortcut: (id: Exclude<ShortcutId, 'toggle-sidebar'>) => void;
}) {
  const narrow = useNarrow();
  const [layout, setLayout] = useState(() => readPref(KEY, Layout, { collapsed: false, width: WIDTH.initial }));
  const [overlayOpen, setOverlayOpen] = useState(false);
  const shortcut = useRef(props.onShortcut);
  shortcut.current = props.onShortcut;
  const update = (next: z.infer<typeof Layout>): void => {
    setLayout(next);
    writePref(KEY, next);
  };
  const toggle = (): void => {
    if (narrow) setOverlayOpen((open) => !open);
    else update({ ...layout, collapsed: !layout.collapsed });
  };
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  useEffect(() => {
    document.documentElement.dataset.platform = PLATFORM;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) {
        if (escapeStack.escape()) event.preventDefault();
        return;
      }
      const id = shortcutOf(event, PLATFORM);
      if (id === null || document.querySelector('dialog[open]') !== null) return;
      event.preventDefault();
      if (id === 'toggle-sidebar') toggleRef.current();
      else shortcut.current(id);
    };
    const onPointer = (event: PointerEvent): void => {
      escapeStack.pointerDown(event.target);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, []);
  useEffect(() => {
    if (!narrow) setOverlayOpen(false);
  }, [narrow]);

  const mode: SidebarMode = narrow ? 'overlay' : layout.collapsed ? 'rail' : 'docked';
  const controls: SidebarControls = {
    toggle,
    dismiss: () => {
      setOverlayOpen(false);
    },
  };
  const resize = (width: number): void => {
    update({ ...layout, width: Math.round(Math.min(WIDTH.max, Math.max(WIDTH.min, width))) });
  };
  return (
    <div class={`shell ${mode}`} style={{ '--sidebar-w': `${String(layout.width)}px` }}>
      {mode !== 'overlay' && props.sidebar(mode, controls)}
      {mode === 'docked' && (
        <div
          class="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuemin={WIDTH.min}
          aria-valuemax={WIDTH.max}
          aria-valuenow={layout.width}
          tabIndex={0}
          onPointerDown={(event) => {
            const handle = event.currentTarget;
            handle.setPointerCapture(event.pointerId);
            const move = (moved: PointerEvent): void => {
              resize(moved.clientX);
            };
            handle.addEventListener('pointermove', move);
            handle.addEventListener('lostpointercapture', () => { handle.removeEventListener('pointermove', move); }, { once: true });
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') resize(layout.width - 8);
            if (event.key === 'ArrowRight') resize(layout.width + 8);
          }}
        />
      )}
      <main class="content">{props.main({ sidebarButton: mode === 'overlay', showSidebar: toggle })}</main>
      {mode === 'overlay' && overlayOpen && (
        <Overlay
          onClose={() => {
            setOverlayOpen(false);
          }}
        >
          {props.sidebar('overlay', controls)}
        </Overlay>
      )}
    </div>
  );
}
