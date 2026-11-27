import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { rovingTarget, typeAheadTarget } from '../../shared/roving.ts';
import { windowOf, type SidebarItem } from './sidebar-window.ts';

const TYPE_AHEAD_MS = 700;

/**
 * The windowed agent list's scrolling and keyboard model: one tab stop (the focused, else the selected, else the first row),
 * arrows, Home/End and type-ahead. Rows outside the window are not in the DOM, so focus moves through state, then a layout effect.
 */
export function useAgentList(items: readonly SidebarItem[], selectedId: string | null, rail: boolean) {
  const [focusId, setFocusId] = useState<string | null>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 600 });
  const list = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef(false);
  const listHasFocus = useRef(false);
  const typed = useRef({ text: '', at: 0 });
  const entries = items.flatMap((item) => (item.kind === 'agent' ? [item.entry] : []));
  const shown = windowOf(items, scroll.top, scroll.height, entries.length, rail);
  const tabStop = [focusId, selectedId].map((id) => entries.find(({ agent }) => agent.id === id)).find((entry) => entry !== undefined)?.agent.id ?? entries[0]?.agent.id;

  const measure = (element: HTMLElement): void => {
    setScroll({ top: element.scrollTop, height: element.clientHeight });
  };
  useEffect(() => {
    const element = list.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => {
      measure(element);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  useLayoutEffect(() => {
    const lost = listHasFocus.current && (document.activeElement === document.body || document.activeElement === null);
    if ((!pendingFocus.current && !lost) || tabStop === undefined) return;
    pendingFocus.current = false;
    list.current?.querySelector<HTMLElement>(`[data-agent="${tabStop}"]`)?.focus();
  });

  const moveTo = (index: number): void => {
    const entry = entries[index];
    const element = list.current;
    if (entry === undefined || element === null) return;
    const top = shown.tops[items.findIndex((item) => item.key === entry.agent.id)] ?? 0;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + shown.rowPx > element.scrollTop + element.clientHeight) element.scrollTop = top + shown.rowPx - element.clientHeight;
    measure(element);
    pendingFocus.current = true;
    setFocusId(entry.agent.id);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.target instanceof HTMLElement) || !event.target.classList.contains('agent-main')) return;
    const current = entries.findIndex(({ agent }) => agent.id === tabStop);
    let next = rovingTarget(event.key, current, entries.length);
    if (next === null && event.key.length === 1 && event.key !== ' ' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      typed.current = { text: event.timeStamp - typed.current.at < TYPE_AHEAD_MS ? typed.current.text + event.key : event.key, at: event.timeStamp };
      const found = typeAheadTarget(entries.map(({ agent }) => agent.name), typed.current.text, typed.current.text.length > 1 ? current - 1 : current);
      next = found === -1 ? null : found;
    }
    if (next === null) return;
    event.preventDefault();
    moveTo(next);
  };

  return {
    list,
    entries,
    shown,
    tabStop,
    moveTo,
    setFocusId,
    onKeyDown,
    onFocusIn: (): void => {
      listHasFocus.current = true;
    },
    onFocusOut: (event: FocusEvent): void => {
      if (event.relatedTarget instanceof Node && !list.current?.contains(event.relatedTarget)) listHasFocus.current = false;
    },
    onScroll: (event: Event): void => {
      if (event.currentTarget instanceof HTMLElement) measure(event.currentTarget);
    },
  };
}
