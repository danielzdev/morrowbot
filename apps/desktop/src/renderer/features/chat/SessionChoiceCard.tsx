import type { SessionChoice, SessionChoiceReason } from '@morrowbot/contracts';
import { sessionChoiceCopy } from './outcome-copy.ts';

/** Above the composer when the host returns `session-choice-required` (spec §4.4), in v23's words. */
export function SessionChoiceCard(props: {
  readonly reason: SessionChoiceReason;
  /** Choices wait while something is sending, or when the draft they would send is empty. */
  readonly held: boolean;
  readonly onChoose: (choice: SessionChoice) => void;
  readonly onCancel: () => void;
}) {
  const copy = sessionChoiceCopy(props.reason);
  return (
    <div class="card choice" role="group" aria-labelledby="session-choice-title">
      <p id="session-choice-title" class="card-title">{copy.prompt}</p>
      <div class="card-actions">
        {copy.options.map((option) => (
          <button
            key={option.choice.kind}
            class={option.choice.kind === 'new-seeded' ? 'primary' : 'secondary'}
            disabled={props.held}
            onClick={() => { props.onChoose(option.choice); }}
          >
            {option.label}
          </button>
        ))}
        <button class="ghost" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
      {copy.options.map((option) => option.warning !== null && <div key={option.choice.kind} class="card-foot">{option.warning}</div>)}
    </div>
  );
}
