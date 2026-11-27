import { Icon } from '../../shared/ui/Icon.tsx';
import { problemText } from './live-region.ts';
import { bannerCopy } from './outcome-copy.ts';
import { SessionChoiceCard } from './SessionChoiceCard.tsx';
import type { ComposerProblem, ThreadSession } from './thread-session.ts';

/**
 * Why the last send did not start, attached to the composer (spec §4.4). The draft is always kept:
 * the host wrote nothing, and Try again sends the draft as it is now.
 */
export function ComposerBanners(props: {
  readonly problem: ComposerProblem | null;
  readonly session: ThreadSession;
  readonly draft: string;
  readonly busy: boolean;
  readonly safe: (text: string) => string | null;
  readonly onOpenProviders: () => void;
}) {
  const { problem, session } = props;
  if (problem === null) return null;
  const nothingToSend = problem.kind !== 'error' && problem.action.kind === 'send' && props.draft.trim() === '';
  const held = props.busy || nothingToSend;
  const dismiss = (): void => { session.dismissProblem(); };
  switch (problem.kind) {
    case 'session-choice':
      return <SessionChoiceCard reason={problem.reason} held={held} onChoose={(choice) => void session.choose(choice)} onCancel={dismiss} />;
    case 'retry': {
      const { action } = bannerCopy(problem.reason);
      return (
        <div class="banner warning">
          <Icon name="warning" size={14} />
          <span class="banner-text">{problemText(problem, props.safe)}</span>
          {action.kind === 'retry' ? (
            <button class="secondary" disabled={held} onClick={() => void session.retry()}>{action.label}</button>
          ) : (
            <button class="secondary" onClick={props.onOpenProviders}>{action.label}</button>
          )}
          <button class="ghost" aria-label="Dismiss" onClick={dismiss}><Icon name="close" size={14} /></button>
        </div>
      );
    }
    case 'error':
      return (
        <div class="banner error">
          <Icon name="warning" size={14} />
          <span class="banner-text">{problemText(problem, props.safe)}</span>
          <button class="ghost" onClick={dismiss}>Dismiss</button>
        </div>
      );
  }
}
