import { Icon } from '../../shared/ui/Icon.tsx';
import { SEED_TRUNCATED, type OutcomeAction, type OutcomeCopy } from './outcome-copy.ts';

/** A reset time in the user's clock: "11:10" today, "Nov 28, 11:10" on another day. */
export function resetTime(iso: string, now: number): string {
  const at = new Date(iso);
  const sameDay = at.toDateString() === new Date(now).toDateString();
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return sameDay ? time : `${at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

/** The icon-plus-text line under a finished reply, with at most one action (spec §4.4). */
export function OutcomeNote(props: {
  readonly copy: OutcomeCopy;
  readonly seedTruncated: boolean;
  /** Actions show only on the chat's latest reply. */
  readonly latest: boolean;
  readonly busy: boolean;
  readonly onAction: (action: OutcomeAction) => void;
}) {
  const { copy } = props;
  const action = props.latest ? copy.action : null;
  return (
    <>
      {props.seedTruncated && <div class="note muted">{SEED_TRUNCATED}</div>}
      {copy.text !== null && (
        <div class={`note outcome ${copy.tone}`}>
          {(copy.tone === 'warning' || copy.tone === 'error') && <Icon name="warning" size={14} />}
          <span>
            {copy.text}
            {copy.resetsAt !== null && ` · resets ${resetTime(copy.resetsAt, Date.now())}`}
          </span>
          {action !== null && (
            <button class="secondary" disabled={props.busy && action.kind === 'continue'} onClick={() => { props.onAction(action); }}>
              {action.label}
            </button>
          )}
        </div>
      )}
    </>
  );
}
