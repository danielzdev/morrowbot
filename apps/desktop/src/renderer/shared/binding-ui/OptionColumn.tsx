import type { ModelOption } from '@morrowbot/contracts';
import { useRef } from 'preact/hooks';
import { Icon } from '../ui/Icon.tsx';
import type { ModelState } from './binding-state.ts';

const STEP: Readonly<Record<string, number>> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

/** One option's choices as a radio group; "Default" marks `defaultChoiceId`. Arrows move focus, and select too when `arrowsSelect`. */
function ChoiceGroup(props: { readonly option: ModelOption; readonly chosen: string; readonly disabled: boolean; readonly arrowsSelect: boolean; readonly onChoose: (choiceId: string) => void }) {
  const group = useRef<HTMLDivElement>(null);
  const { option } = props;
  return (
    <div class="option-block">
      <div class="kicker">{option.label}</div>
      <div
        ref={group}
        role="radiogroup"
        aria-label={option.label}
        class="option-choices"
        onKeyDown={(event) => {
          const step = STEP[event.key];
          if (step === undefined) return;
          event.preventDefault();
          const active = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.choice : undefined;
          const from = props.arrowsSelect ? props.chosen : (active ?? props.chosen);
          const at = option.choices.findIndex(({ id }) => id === from);
          const next = option.choices[(at + step + option.choices.length) % option.choices.length];
          if (next === undefined) return;
          if (props.arrowsSelect && !props.disabled) props.onChoose(next.id);
          group.current?.querySelector<HTMLElement>(`[data-choice="${next.id}"]`)?.focus();
        }}
      >
        {option.choices.map((choice, index) => {
          const checked = choice.id === props.chosen;
          const reachable = checked || (index === 0 && !option.choices.some(({ id }) => id === props.chosen));
          return (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={checked}
              data-choice={choice.id}
              tabIndex={reachable ? 0 : -1}
              aria-disabled={props.disabled}
              class={`option-choice ${checked ? 'selected' : ''}`}
              onClick={() => {
                if (!checked && !props.disabled) props.onChoose(choice.id);
              }}
            >
              <span class="check">{checked && <Icon name="check" />}</span>
              <span>{choice.label}</span>
              {choice.id === option.defaultChoiceId && <span class="tag">Default</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The selected model's options (spec §4.6 rule 8), each headed with the provider's own label. */
export function OptionColumn(props: {
  readonly state: ModelState;
  /** While a pick is saving: choices stay focusable but say they are unavailable, and picks are ignored. */
  readonly disabled: boolean;
  /** False in the popover, where each pick is saved: arrows only move, Space or Enter picks. */
  readonly arrowsSelect?: boolean;
  readonly onChoose: (optionId: string, choiceId: string) => void;
}) {
  const { state } = props;
  if (state.kind === 'not-ready') return null;
  const anyOptions = state.models.some(({ options }) => options.length > 0);
  const { current } = state;
  switch (current.kind) {
    case 'auto':
    case 'unavailable':
      return <p class="binding-note option-column">{anyOptions ? 'Pick a model to adjust effort.' : 'Effort unavailable'}</p>;
    case 'unreported':
      return <p class="binding-note option-column">Effort unavailable</p>;
    case 'pinned':
      break;
  }
  if (current.model.options.length === 0) {
    return <p class="binding-note option-column">{anyOptions ? `Effort isn't adjustable for ${current.model.label}` : 'Effort unavailable'}</p>;
  }
  return (
    <div class="option-column">
      {current.model.options.map((option) => (
        <ChoiceGroup
          key={option.id}
          option={option}
          chosen={current.choices[option.id] ?? option.defaultChoiceId}
          disabled={props.disabled}
          arrowsSelect={props.arrowsSelect !== false}
          onChoose={(choiceId) => {
            props.onChoose(option.id, choiceId);
          }}
        />
      ))}
    </div>
  );
}
