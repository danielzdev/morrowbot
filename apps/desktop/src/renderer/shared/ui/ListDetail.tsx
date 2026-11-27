import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import { handleRovingKey } from '../roving.ts';

/**
 * The list/detail pattern (spec §6.2) shared by Settings › Providers and Extensions: a list of rows
 * on the left (↑/↓/Home/End move, one tab stop) and the selected row's detail on the right.
 */
export function ListDetail(props: { readonly label: string; readonly list: ComponentChildren; readonly footer?: ComponentChildren; readonly detail: ComponentChildren }) {
  const list = useRef<HTMLDivElement>(null);
  return (
    <div class="list-detail">
      <div class="list-pane">
        <div
          ref={list}
          class="list-rows"
          role="group"
          aria-label={props.label}
          onKeyDown={(event) => {
            if (list.current !== null) handleRovingKey(event, list.current);
          }}
        >
          {props.list}
        </div>
        {props.footer !== undefined && <div class="list-footer">{props.footer}</div>}
      </div>
      <div class="detail-pane">{props.detail}</div>
    </div>
  );
}

/** One row of a ListDetail list: a button that selects it, with an optional control (a switch) beside it. */
export function ListRow(props: {
  readonly label: string;
  readonly selected: boolean;
  /** The list's one tab stop: the selected row, or the first when none is. */
  readonly tabStop: boolean;
  readonly onSelect: () => void;
  readonly children: ComponentChildren;
  readonly control?: ComponentChildren;
}) {
  return (
    <div class={`list-row${props.selected ? ' selected' : ''}`}>
      <button
        type="button"
        class="list-row-main"
        data-roving={props.label}
        tabIndex={props.tabStop ? 0 : -1}
        aria-current={props.selected ? 'true' : undefined}
        onClick={props.onSelect}
      >
        {props.children}
      </button>
      {props.control}
    </div>
  );
}

/** A status pill: words always, colour as a second signal. */
export function Pill(props: { readonly tone: 'ok' | 'muted' | 'warning' | 'error'; readonly children: ComponentChildren }) {
  return <span class={`pill ${props.tone}`}>{props.children}</span>;
}

/** One titled part of a detail pane. */
export function DetailSection(props: { readonly title: string; readonly children: ComponentChildren }) {
  return (
    <section class="detail-section" aria-label={props.title}>
      <h3 class="kicker">{props.title}</h3>
      {props.children}
    </section>
  );
}
