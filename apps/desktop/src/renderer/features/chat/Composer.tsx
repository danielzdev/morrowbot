import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { Icon } from '../../shared/ui/Icon.tsx';
import { useStore } from '../../shared/use-store.ts';
import type { ComposerProblem, ThreadSession } from './thread-session.ts';

function Problem(props: { readonly problem: ComposerProblem; readonly session: ThreadSession; readonly draft: string; readonly busy: boolean }) {
  const { problem, session } = props;
  const nothingToSend = problem.kind !== 'error' && problem.action.kind === 'send' && props.draft.trim() === '';
  const held = props.busy || nothingToSend;
  switch (problem.kind) {
    case 'session-choice':
      return (
        <div class="card choice" role="alertdialog" aria-label="Session choice">
          <div class="card-body">{problem.prompt}</div>
          <div class="card-actions">
            {problem.options.map((option) => (
              <button key={option.choice.kind} class="primary" disabled={held} onClick={() => void session.choose(option.choice)}>
                {option.label}
              </button>
            ))}
            <button
              class="ghost"
              onClick={() => {
                session.dismissProblem();
              }}
            >
              Cancel
            </button>
          </div>
          {problem.options.map(
            (option) => option.warning !== null && <div key={option.choice.kind} class="card-foot">{option.warning}</div>,
          )}
        </div>
      );
    case 'retry':
      return (
        <div class="banner warning">
          <div class="banner-row">
            <span>{problem.message} Your message was kept.</span>
            <button class="secondary" disabled={held} onClick={() => void session.retry()}>
              Retry
            </button>
          </div>
        </div>
      );
    case 'error':
      return (
        <div class="banner error">
          <div class="banner-row">
            <span>{problem.message}</span>
            <button
              class="ghost"
              onClick={() => {
                session.dismissProblem();
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      );
  }
}

const MAX_LINES = 12;

/** Grows the box with its text, from one line up to twelve. */
function fit(box: HTMLTextAreaElement): void {
  box.style.height = 'auto';
  const line = Number.parseFloat(getComputedStyle(box).lineHeight) || 22;
  box.style.height = `${String(Math.min(box.scrollHeight, line * MAX_LINES))}px`;
}

/**
 * The message box (spec §4.5). `toolbar` holds the binding and access pills, `notes` the warning
 * strip shown under it while a warning applies. Enter sends, except while composing text.
 */
export function Composer(props: {
  readonly session: ThreadSession;
  readonly agentName: string;
  readonly toolbar: ComponentChildren;
  readonly notes?: ComponentChildren;
  readonly disabledReason: string | null;
}) {
  const { session } = props;
  const screen = useStore(session.screen);
  const box = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (box.current !== null) fit(box.current);
  }, [screen.draft]);
  const view = screen.view.kind === 'loaded' ? screen.view.value : null;
  const running = view?.activeTurn != null;
  const blocked = (view?.blockedGroups.length ?? 0) > 0;
  const canSend = view !== null && !running && !blocked && screen.busy === null && props.disabledReason === null && screen.draft.trim() !== '';
  return (
    <div class="composer">
      {screen.problem !== null && <Problem problem={screen.problem} session={session} draft={screen.draft} busy={screen.busy !== null || props.disabledReason !== null} />}
      <div class="composer-box">
        <textarea
          ref={box}
          aria-label="Message"
          placeholder={running ? 'Wait for the reply, or stop it…' : `Message ${props.agentName}…`}
          value={screen.draft}
          rows={1}
          onInput={(event) => {
            session.setDraft(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
              event.preventDefault();
              if (canSend) void session.send();
            }
          }}
        />
        <div class="composer-bar">
          <div class="toolbar">{props.toolbar}</div>
          {props.disabledReason !== null && !running && <span class="composer-reason">{props.disabledReason}</span>}
          {running ? (
            <button class="round-btn stop" aria-label={screen.busy === 'stopping' ? 'Stopping…' : 'Stop'} title="Stop" disabled={screen.busy !== null} onClick={() => void session.stop()}>
              <Icon name="stop" />
            </button>
          ) : (
            <button class="round-btn send" aria-label={screen.busy === 'sending' ? 'Sending…' : 'Send'} title="Send" disabled={!canSend} onClick={() => void session.send()}>
              <Icon name="send" />
            </button>
          )}
        </div>
      </div>
      {props.notes}
    </div>
  );
}
