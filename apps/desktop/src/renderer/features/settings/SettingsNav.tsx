import type { RefObject } from 'preact';
import { focusRoving, handleRovingKey } from '../../shared/roving.ts';
import { Icon } from '../../shared/ui/Icon.tsx';
import { SECTIONS, type SearchGroup, type SettingEntry } from './settings-index.ts';

const resultsOf = (list: HTMLElement | null): HTMLElement[] => (list === null ? [] : [...list.querySelectorAll<HTMLElement>('[data-roving]')]);

/**
 * The search field on top of the Settings nav (spec §6). `/` focuses it from anywhere in Settings;
 * Enter opens the first match, ↓ moves into the matches, Esc clears it before it closes Settings.
 */
export function SettingsSearchField(props: {
  readonly input: RefObject<HTMLInputElement | null>;
  readonly results: RefObject<HTMLDivElement | null>;
  readonly query: string;
  readonly first: SettingEntry | null;
  readonly onQuery: (query: string) => void;
  readonly onPick: (entry: SettingEntry) => void;
}) {
  return (
    <div class="settings-search">
      <Icon name="search" />
      <input
        ref={props.input}
        type="text"
        role="searchbox"
        aria-label="Search settings"
        aria-keyshortcuts="/"
        placeholder="Search"
        spellcheck={false}
        value={props.query}
        onInput={(event) => {
          props.onQuery(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.isComposing) return;
          if (event.key === 'Escape' && props.query !== '') {
            event.preventDefault();
            props.onQuery('');
          } else if (event.key === 'Enter' && props.first !== null) {
            event.preventDefault();
            props.onPick(props.first);
          } else if (event.key === 'ArrowDown') {
            const items = resultsOf(props.results.current);
            if (items.length === 0) return;
            event.preventDefault();
            focusRoving(items, 0);
          }
        }}
      />
      {props.query === '' && <kbd aria-hidden="true">/</kbd>}
    </div>
  );
}

/**
 * The matches for a search, listed by section; picking one opens its row. ↑ from the first goes back
 * to the field and Esc clears the search. Key it on the query, so each search starts with the first match as its tab stop.
 */
export function SettingsSearchResults(props: {
  readonly results: RefObject<HTMLDivElement | null>;
  readonly query: string;
  readonly groups: readonly SearchGroup[];
  readonly onPick: (entry: SettingEntry) => void;
  readonly onBack: () => void;
  readonly onClear: () => void;
}) {
  const count = props.groups.reduce((total, group) => total + group.entries.length, 0);
  return (
    <div
      ref={props.results}
      class="settings-results"
      onKeyDown={(event) => {
        const items = resultsOf(props.results.current);
        if (event.key === 'Escape') {
          event.preventDefault();
          props.onClear();
          return;
        }
        if (event.key === 'ArrowUp' && items[0] === document.activeElement) {
          event.preventDefault();
          props.onBack();
          return;
        }
        if (props.results.current !== null) handleRovingKey(event, props.results.current);
      }}
    >
      <p class="settings-results-count" role="status">
        {count === 0 ? `No settings match “${props.query.trim()}”.` : count === 1 ? '1 setting' : `${String(count)} settings`}
      </p>
      {props.groups.map((group) => (
        <div key={group.section} class="settings-results-group" role="group" aria-label={SECTIONS[group.section].title}>
          <div class="kicker">{SECTIONS[group.section].title}</div>
          {group.entries.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              class="settings-result"
              data-roving={entry.label}
              tabIndex={group === props.groups[0] && index === 0 ? 0 : -1}
              onClick={() => {
                props.onPick(entry);
              }}
            >
              <span class="setting-label">{entry.label}</span>
              <span class="setting-description">{entry.description}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
