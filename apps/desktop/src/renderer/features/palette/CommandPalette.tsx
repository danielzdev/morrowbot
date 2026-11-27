import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../../shared/ui/Icon.tsx';
import { Modal } from '../../shared/ui/Modal.tsx';
import { GROUP_TITLES, searchPalette, stepActive, type PaletteItem } from './commands.ts';

const LIST_ID = 'palette-list';
const optionId = (index: number): string => `palette-option-${String(index)}`;

/**
 * The command palette (⌘K, spec §3.5): one search over actions, agents, chats and settings. Focus
 * stays in the field; ↑/↓ move the highlight, Enter runs it, Esc closes and focus goes back to
 * where it was. `onRun` is called instead of `onClose` when a row is picked.
 */
export function CommandPalette(props: {
  readonly items: readonly PaletteItem[];
  /** A line under the list, such as why some chats are missing. */
  readonly note: string | null;
  readonly onClose: () => void;
  readonly onRun: (item: PaletteItem) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const sections = searchPalette(props.items, query);
  const flat = sections.flatMap((section) => section.items);
  const current = Math.min(active, Math.max(flat.length - 1, 0));
  const chosen = flat[current];

  useLayoutEffect(() => {
    list.current?.querySelector(`#${optionId(current)}`)?.scrollIntoView({ block: 'nearest' });
  }, [current, query]);

  let index = -1;
  return (
    <Modal label="Command palette" class="palette" onClose={props.onClose}>
      <div class="palette-search">
        <Icon name="search" />
        <input
          type="text"
          role="combobox"
          aria-label="Search actions, agents, chats and settings"
          aria-expanded="true"
          aria-controls={LIST_ID}
          aria-autocomplete="list"
          aria-activedescendant={chosen === undefined ? undefined : optionId(current)}
          placeholder="Search actions, agents, chats and settings"
          spellcheck={false}
          value={query}
          onInput={(event) => {
            setQuery(event.currentTarget.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.isComposing) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setActive(stepActive(current, event.key === 'ArrowDown' ? 1 : -1, flat.length));
            } else if (event.key === 'Enter' && chosen !== undefined) {
              event.preventDefault();
              props.onRun(chosen);
            }
          }}
        />
      </div>
      <div ref={list} id={LIST_ID} class="palette-list" role="listbox" aria-label="Results">
        {sections.map((section) => (
          <div key={section.group} class="palette-group" role="group" aria-labelledby={`palette-group-${section.group}`}>
            <div id={`palette-group-${section.group}`} class="kicker" role="presentation">
              {GROUP_TITLES[section.group]}
            </div>
            {section.items.map((item) => {
              index += 1;
              const at = index;
              return (
                <div
                  key={item.id}
                  id={optionId(at)}
                  class="palette-option"
                  role="option"
                  aria-selected={at === current}
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onMouseMove={() => {
                    if (at !== current) setActive(at);
                  }}
                  onClick={() => {
                    props.onRun(item);
                  }}
                >
                  <span class="palette-leading" aria-hidden="true">
                    {item.leading}
                  </span>
                  <span class="palette-label">{item.label}</span>
                  {item.detail !== '' && <span class="palette-detail">{item.detail}</span>}
                  {item.hint !== '' && <kbd class="palette-hint">{item.hint}</kbd>}
                </div>
              );
            })}
          </div>
        ))}
        {flat.length === 0 && <p class="palette-empty">Nothing matches “{query.trim()}”.</p>}
      </div>
      <p class="visually-hidden" role="status">
        {query.trim() === '' ? '' : flat.length === 1 ? '1 result' : `${String(flat.length)} results`}
      </p>
      {props.note !== null && <p class="palette-note">{props.note}</p>}
      <footer class="palette-footer" aria-hidden="true">
        <span>↑↓ Navigate</span>
        <span>↩ Open</span>
        <span>Esc Close</span>
      </footer>
    </Modal>
  );
}
