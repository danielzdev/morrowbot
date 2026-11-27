import type { ApprovalChoice } from '@morrowbot/contracts';
import { InlineMarkdown, type MarkdownActions } from './Markdown.tsx';
import { APPROVAL_FOOTNOTE, approvalEndingCopy } from './outcome-copy.ts';
import type { ApprovalStep } from './thread-model.ts';

/** Shown when an approval summary can't be made safe to display. */
const UNSAFE_TITLE = 'Allow this action?';

/** The id of an approval card's heading: a jump to the card focuses it, never Allow. */
export const approvalHeadingId = (approvalId: string): string => `approval-${approvalId}`;

/** Deny-style choices first; Allow last and primary (spec §4.3). */
const ordered = (choices: readonly ApprovalChoice[]): ApprovalChoice[] =>
  [...choices].sort((a, b) => Number(a.id === 'allow') - Number(b.id === 'allow'));

/**
 * An approval request inline in its turn: pending, then sending ("Sending…", buttons disabled),
 * then its ending as final text with the buttons removed. A countdown would need the host's
 * `expiresAt`, which the wire does not carry yet, so none is shown.
 */
export function ApprovalCard(props: {
  readonly step: ApprovalStep;
  /** `held`: the buttons wait, e.g. while the host is reconnecting. */
  readonly answer: 'open' | 'sending' | 'held';
  /** The approval summary made safe to show (spec §9.1), or null when it can't be. */
  readonly title: string | null;
  readonly actions: MarkdownActions;
  readonly onAnswer: (choiceId: string) => void;
}) {
  const { approval, ending } = props.step;
  const heading = approvalHeadingId(approval.approvalId);
  return (
    <div class={`card approval ${ending === null ? 'pending' : 'ended'}`} role="group" aria-labelledby={heading}>
      <p id={heading} class="card-title" tabIndex={-1}>
        <InlineMarkdown text={props.title ?? UNSAFE_TITLE} actions={props.actions} />
      </p>
      {ending === null ? (
        <>
          <div class="card-actions">
            {ordered(approval.choices).map((choice) => (
              <button
                key={choice.id}
                class={choice.id === 'allow' ? 'primary' : 'secondary'}
                disabled={props.answer !== 'open'}
                onClick={() => { props.onAnswer(choice.id); }}
              >
                {choice.label}
              </button>
            ))}
            {props.answer === 'sending' && <span class="card-status" role="status">Sending…</span>}
          </div>
          <div class="card-foot">{APPROVAL_FOOTNOTE}</div>
        </>
      ) : (
        <div class={`card-ending ${ending.kind}`}>{approvalEndingCopy(ending)}</div>
      )}
    </div>
  );
}
