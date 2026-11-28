import { useRef } from 'preact/hooks';
import { handleRovingKey } from '../roving.ts';
import { Tooltip } from '../ui/Tooltip.tsx';
import { ProviderGlyph } from './ProviderGlyph.tsx';
import { isRunnable, readinessOf, statusLine, type ProviderChoice, type Readiness } from './selection.ts';

const toneOf = (readiness: Readiness): 'ok' | 'warn' | 'danger' | 'muted' => {
  switch (readiness.kind) {
    case 'ready':
      return readiness.warned ? 'warn' : 'ok';
    case 'off':
    case 'checking':
      return 'muted';
    case 'missing-runtime':
    case 'outdated':
    case 'signed-out':
    case 'no-access':
      return 'warn';
    case 'down':
    case 'error':
      return 'danger';
  }
};

/**
 * The providers to choose from (spec §4.6): a 44px icon rail with status dots (names in tooltips and
 * labels) in the popover, or cards with the status line in New Agent and Agent Settings. On the rail
 * every provider can be browsed; as cards, only runnable ones can be picked.
 */
export function ProviderRail(props: {
  readonly label: string;
  readonly layout: 'rail' | 'cards';
  readonly choices: readonly ProviderChoice[];
  readonly selected: string | null;
  readonly onPick: (id: string) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const focusable = props.choices.find(({ id }) => id === props.selected)?.id ?? props.choices[0]?.id;
  return (
    <div
      ref={list}
      role="radiogroup"
      aria-label={props.label}
      class={`provider-${props.layout}`}
      onKeyDown={(event) => {
        if (list.current !== null && handleRovingKey(event, list.current)) {
          const id = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.id : undefined;
          if (props.layout === 'rail' && id !== undefined) props.onPick(id);
        }
      }}
    >
      {props.choices.map((choice) => {
        const readiness = readinessOf(choice);
        const line = statusLine(readiness);
        const pickable = props.layout === 'rail' || isRunnable(choice);
        const checked = choice.id === props.selected;
        const button = (
          <button
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={pickable ? undefined : true}
            aria-label={props.layout === 'rail' ? `${choice.name}: ${line}` : undefined}
            data-roving={choice.name}
            data-id={choice.id}
            tabIndex={choice.id === focusable ? 0 : -1}
            class={`provider-option ${checked ? 'selected' : ''}`}
            onClick={() => {
              if (pickable) props.onPick(choice.id);
            }}
          >
            <span class="provider-mark">
              <ProviderGlyph id={choice.id} name={choice.name} />
              <span class={`status-dot ${toneOf(readiness)}`} aria-hidden="true" />
            </span>
            {props.layout === 'cards' && (
              <span class="provider-text">
                <span class="provider-name">{choice.name}</span>
                <span class={`provider-status ${toneOf(readiness)}`}>{line}</span>
              </span>
            )}
          </button>
        );
        return props.layout === 'rail' ? (
          <Tooltip key={choice.id} label={`${choice.name} · ${line}`} side="right">
            {button}
          </Tooltip>
        ) : (
          <div key={choice.id}>{button}</div>
        );
      })}
    </div>
  );
}
