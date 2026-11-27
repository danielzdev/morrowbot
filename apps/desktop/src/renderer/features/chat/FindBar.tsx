import type { RefObject } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { escapeStack } from '../../shared/escape-stack.ts';
import { Icon } from '../../shared/ui/Icon.tsx';
import { findMatches, occurrences, searchableOf, stepMatch, type FindMatch } from './find.ts';
import type { ThreadView } from './thread-model.ts';

/** Text nodes under `root` in reading order, leaving out labels and buttons marked `data-find-skip`. */
function textNodes(root: Element): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest('[data-find-skip]') == null ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) if (node instanceof Text) nodes.push(node);
  return nodes;
}

/** A range over `length` characters from `offset` in the joined text of `nodes`. */
function rangeAt(nodes: readonly Text[], offset: number, length: number): Range | null {
  const range = document.createRange();
  let seen = 0;
  let started = false;
  for (const node of nodes) {
    const end = seen + node.data.length;
    if (!started && offset < end) {
      range.setStart(node, offset - seen);
      started = true;
    }
    if (started && offset + length <= end) {
      range.setEnd(node, offset + length - seen);
      return range;
    }
    seen = end;
  }
  return null;
}

/** Paints every rendered match and the current one; returns the current match's range. */
function paint(root: HTMLElement, query: string, current: FindMatch | null): Range | null {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return null;
  const all: Range[] = [];
  let found: Range | null = null;
  if (query !== '') {
    for (const element of root.querySelectorAll<HTMLElement>('[data-find-id]')) {
      const nodes = textNodes(element);
      const text = nodes.map(({ data }) => data).join('');
      for (const [nth, span] of occurrences(text, query).entries()) {
        const range = rangeAt(nodes, span.at, span.length);
        if (range === null) continue;
        all.push(range);
        if (current !== null && current.id === element.dataset.findId && current.nth === nth) found = range;
      }
    }
  }
  CSS.highlights.set('find', new Highlight(...all));
  CSS.highlights.set('find-current', found === null ? new Highlight() : new Highlight(found));
  return found;
}

function clear(): void {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return;
  CSS.highlights.delete('find');
  CSS.highlights.delete('find-current');
}

/**
 * Find in this chat (⌘F, spec §4.1): an inline bar with a match count and ↑/↓. It searches every
 * loaded message, and asks for older ones to be rendered when a match is among them.
 */
export function FindBar(props: {
  readonly view: ThreadView;
  readonly scroller: RefObject<HTMLElement | null>;
  /** Changes whenever the rendered messages do, so matches are painted again. */
  readonly rendered: string;
  /** Bumped by every ⌘F, to focus the field again. */
  readonly focusRequest: number;
  /** The first rendered message's position: a new search starts at the first match from there, so it does not render older ones. */
  readonly firstRendered: number;
  readonly onReveal: (messageId: string) => void;
  readonly onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState<number | null>(null);
  const matches = useMemo(() => findMatches(searchableOf(props.view), query), [props.view.messages, props.view.activeTurn?.text, query]);
  const shownFirst = matches.findIndex(({ item }) => item >= props.firstRendered);
  const at = index === null ? (shownFirst === -1 ? matches.length - 1 : shownFirst) : Math.min(index, matches.length - 1);
  const current = matches[at] ?? null;
  const close = useRef(props.onClose);
  close.current = props.onClose;
  useEffect(() => {
    const before = document.activeElement;
    const pop = escapeStack.push({
      close: () => { close.current(); },
      returnFocus: before instanceof HTMLElement ? before : null,
      contains: () => true,
    });
    return () => {
      pop();
      clear();
    };
  }, []);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [props.focusRequest]);
  useEffect(() => {
    if (current !== null) props.onReveal(current.id);
  }, [current?.id, current?.nth]);
  useEffect(() => {
    const root = props.scroller.current;
    if (root === null) return;
    const range = paint(root, query, current);
    if (range === null) return;
    range.startContainer.parentElement?.closest('[data-find-id]')?.scrollIntoView({ block: 'nearest' });
    const rect = range.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    if (rect.top < box.top + 48 || rect.bottom > box.bottom - 48) root.scrollTop += rect.top - box.top - box.height / 2;
  }, [query, current?.id, current?.nth, props.rendered]);
  const step = (by: 1 | -1): void => { setIndex(stepMatch(matches.length, at, by)); };
  const count = query === '' ? '' : matches.length === 0 ? 'No results' : `${String(at + 1)} of ${String(matches.length)}`;
  return (
    <div class="find-bar" role="search" aria-label="Find in chat">
      <input
        ref={input}
        type="search"
        aria-label="Find in chat"
        placeholder="Find in chat"
        value={query}
        onInput={(event) => {
          setQuery(event.currentTarget.value);
          setIndex(null);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          step(event.shiftKey ? -1 : 1);
        }}
      />
      <span class="find-count" role="status">{count}</span>
      <button class="icon-btn find-prev" aria-label="Previous match" disabled={matches.length === 0} onClick={() => { step(-1); }}>
        <Icon name="chevron-down" size={14} />
      </button>
      <button class="icon-btn" aria-label="Next match" disabled={matches.length === 0} onClick={() => { step(1); }}>
        <Icon name="chevron-down" size={14} />
      </button>
      <button class="icon-btn" aria-label="Close find" onClick={props.onClose}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
