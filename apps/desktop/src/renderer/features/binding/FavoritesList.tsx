import { useRef } from 'preact/hooks';
import { ProviderGlyph } from '../../shared/binding-ui/ProviderGlyph.tsx';
import { StarButton } from '../../shared/binding-ui/ModelList.tsx';
import { handleRovingKey } from '../../shared/roving.ts';
import { Icon } from '../../shared/ui/Icon.tsx';
import type { BoundProvider } from './binding-display.ts';
import type { FavoriteRow } from './picker.ts';

/** The picker's Favorites tab: every starred model that can run now, each with its provider's icon. */
export function FavoritesList(props: {
  readonly rows: readonly FavoriteRow[];
  readonly binding: BoundProvider;
  readonly disabled: boolean;
  readonly onPick: (row: FavoriteRow) => void;
  readonly onUnstar: (row: FavoriteRow) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const { binding } = props;
  if (props.rows.length === 0) return <p class="binding-note">Star a model to keep it here.</p>;
  const isCurrent = ({ choice, model }: FavoriteRow): boolean =>
    choice.id === binding.pluginId && binding.selection.kind === 'model' && binding.selection.id === model.id;
  const current = props.rows.findIndex(isCurrent);
  return (
    <div
      ref={list}
      role="listbox"
      aria-label="Favorite models"
      class="model-options"
      onKeyDown={(event) => {
        if (list.current !== null) handleRovingKey(event, list.current);
      }}
    >
      {props.rows.map((row, index) => {
        const selected = index === current;
        return (
          <div key={`${row.choice.id}/${row.model.id}`} role="none" class="model-row">
            <button
              type="button"
              role="option"
              aria-selected={selected}
              data-roving={row.model.label}
              data-autofocus={selected ? true : undefined}
              tabIndex={selected || (current === -1 && index === 0) ? 0 : -1}
              aria-disabled={props.disabled}
              class={`model-option ${selected ? 'selected' : ''}`}
              onClick={() => {
                if (!props.disabled) props.onPick(row);
              }}
            >
              <span class="check">{selected && <Icon name="check" />}</span>
              <ProviderGlyph id={row.choice.id} name={row.choice.name} size="sm" />
              <span class="model-label">{row.model.label}</span>
              <span class="muted">{row.choice.name}</span>
            </button>
            <StarButton starred={true} onToggle={() => { props.onUnstar(row); }} />
          </div>
        );
      })}
    </div>
  );
}
