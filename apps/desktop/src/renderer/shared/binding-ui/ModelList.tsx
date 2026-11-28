import type { ProviderModel } from '@morrowbot/contracts';
import { useRef, useState } from 'preact/hooks';
import { PLATFORM } from '../keys.ts';
import { handleRovingKey } from '../roving.ts';
import { Icon } from '../ui/Icon.tsx';
import type { CurrentModel, ModelState } from './binding-state.ts';

/** The model a ⌘1–9 press picks among the shown models, or null. */
export function numberedModel(event: KeyboardEvent, shown: readonly ProviderModel[]): ProviderModel | null {
  const mod = PLATFORM === 'mac' ? event.metaKey : event.ctrlKey;
  if (!mod || event.shiftKey || event.altKey || !/^[1-9]$/.test(event.key)) return null;
  return shown[Number(event.key) - 1] ?? null;
}

const SEARCH_AT = 7;

/** Which models are starred, and how to star or unstar one. */
export interface Stars {
  readonly starred: (modelId: string) => boolean;
  readonly onToggle: (modelId: string) => void;
}

/** A row's golden star: filled when starred, else shown on hover. Not a tab stop: the row is. */
export function StarButton(props: { readonly starred: boolean; readonly onToggle: () => void }) {
  const label = props.starred ? 'Remove from favorites' : 'Add to favorites';
  return (
    <button
      type="button"
      tabIndex={-1}
      class={`star-button ${props.starred ? 'starred' : ''}`}
      aria-label={label}
      aria-pressed={props.starred}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        props.onToggle();
      }}
    >
      <Icon name="star" />
    </button>
  );
}

/**
 * The selected provider's models (spec §4.6): search, ⌘1–9, a check on the saved model and a
 * Recommended tag. "Default" is never a model label: Auto names who chooses instead.
 */
export function ModelList(props: {
  readonly state: ModelState;
  /** Who chooses on Auto, such as "Claude Code". */
  readonly runtime: string;
  /** While a pick is saving: options stay focusable but say they are unavailable, and picks are ignored. */
  readonly disabled: boolean;
  /** False while browsing another provider: nothing there is this agent's yet. */
  readonly showCurrent?: boolean;
  /** The composer's stars; left out, rows have none (Agent Settings, New Agent). */
  readonly stars?: Stars;
  readonly onPick: (model: ProviderModel) => void;
}) {
  const [query, setQuery] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const { state } = props;
  if (state.kind === 'not-ready') return null;
  if (state.waiting) {
    return (
      <div class="model-list">
        <p class="binding-note">Waiting for the provider to report models.</p>
        {state.current.kind === 'unreported' && <p class="binding-note">{`${state.current.id} · availability not reported`}</p>}
      </div>
    );
  }
  const current: CurrentModel = props.showCurrent === false ? { kind: 'auto' } : state.current;
  const wanted = state.models.length >= SEARCH_AT ? query.trim().toLowerCase() : '';
  const shown = wanted === '' ? state.models : state.models.filter(({ id, label }) => label.toLowerCase().includes(wanted) || id.toLowerCase().includes(wanted));
  const selectedId = current.kind === 'pinned' ? current.model.id : null;
  return (
    <div
      class="model-list"
      onKeyDown={(event) => {
        const numbered = numberedModel(event, shown);
        if (numbered !== null) {
          event.preventDefault();
          if (!props.disabled) props.onPick(numbered);
          return;
        }
        if (event.target instanceof HTMLInputElement) {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          list.current?.querySelector<HTMLElement>('[data-roving]')?.focus();
          return;
        }
        if (list.current !== null) handleRovingKey(event, list.current);
      }}
    >
      {current.kind === 'auto' && props.showCurrent !== false && (
        <p class="binding-note">
          <strong>{`Auto · chosen by ${props.runtime}`}</strong> Pin a model below to choose one.
        </p>
      )}
      {current.kind === 'unavailable' && <p class="binding-note warn">{`${current.id} (unavailable) · Pick another model`}</p>}
      {current.kind === 'unreported' && <p class="binding-note">{`${current.id} · availability not reported`}</p>}
      {state.models.length === 0 ? (
        <p class="binding-note">No models reported</p>
      ) : (
        <>
          {state.models.length >= SEARCH_AT && (
            <input
              type="search"
              class="model-search"
              aria-label="Search models"
              placeholder="Search models"
              value={query}
              onInput={(event) => {
                setQuery(event.currentTarget.value);
              }}
            />
          )}
          <div ref={list} role="listbox" aria-label="Models" class="model-options">
            {shown.map((model, index) => {
              const selected = model.id === selectedId;
              const { stars } = props;
              return (
                <div key={model.id} role="none" class="model-row">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-roving={model.label}
                  data-autofocus={selected ? true : undefined}
                  tabIndex={selected || (selectedId === null && index === 0) ? 0 : -1}
                  aria-disabled={props.disabled}
                  class={`model-option ${selected ? 'selected' : ''}`}
                  onClick={() => {
                    if (!props.disabled) props.onPick(model);
                  }}
                >
                  <span class="check">{selected && <Icon name="check" />}</span>
                  <span class="model-label">{model.label}</span>
                  {model.isDefault && <span class="tag">Recommended</span>}
                  {index < 9 && <kbd>{`${PLATFORM === 'mac' ? '⌘' : 'Ctrl+'}${String(index + 1)}`}</kbd>}
                </button>
                {stars !== undefined && <StarButton starred={stars.starred(model.id)} onToggle={() => { stars.onToggle(model.id); }} />}
                </div>
              );
            })}
            {shown.length === 0 && <p class="binding-note">No model matches.</p>}
          </div>
        </>
      )}
    </div>
  );
}
