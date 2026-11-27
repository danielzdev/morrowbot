import type { ModelOption } from '@morrowbot/contracts';
import { useRef } from 'preact/hooks';
import { Icon } from '../ui/Icon.tsx';
import type { ModelState } from './binding-state.ts';

const STEP: Readonly<Record<string, number>> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

/** One option's choices as a radio group: arrows move and select, "Default" marks `defaultChoiceId`. */
function ChoiceGroup(props: { readonly option: ModelOption; readonly chosen: string; readonly disabled: boolean; readonly onChoose: (choiceId: string) => void }) {
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
          if (step === undefined || props.disabled) return;
          event.preventDefault();
          const at = option.choices.findIndex(({ id }) => id === props.chosen);
          const next = option.choices[(at + step + option.choices.length) % option.choices.length];
          if (next === undefined) return;
          props.onChoose(next.id);
          group.current?.querySelector<HTMLElement>(`[data-choice="${next.id}"]`)?.focus();
        }}
      >
        {option.choices.map((choice) => {
          const checked = choice.id === props.chosen;
          return (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={checked}
              data-choice={choice.id}
              tabIndex={checked ? 0 : -1}
              disabled={props.disabled}
              class={`option-choice ${checked ? 'selected' : ''}`}
              onClick={() => {
                props.onChoose(choice.id);
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
  readonly disabled: boolean;
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
          onChoose={(choiceId) => {
            props.onChoose(option.id, choiceId);
          }}
        />
      ))}
    </div>
  );
}
