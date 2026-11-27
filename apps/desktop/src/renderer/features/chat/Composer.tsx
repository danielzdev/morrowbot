import type { ComponentChildren } from 'preact';
import type { SendWith } from '../../shared/chat-prefs.ts';
import { isSendPress, PLATFORM } from '../../shared/keys.ts';
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

/** The message box. `toolbar` holds the agent's model and access pickers; `sendWith` is Settings › Chat › Send with. */
export function Composer(props: { readonly session: ThreadSession; readonly toolbar: ComponentChildren; readonly disabledReason: string | null; readonly sendWith: SendWith }) {
  const { session } = props;
  const screen = useStore(session.screen);
  const view = screen.view.kind === 'loaded' ? screen.view.value : null;
  const running = view?.activeTurn != null;
  const blocked = (view?.blockedGroups.length ?? 0) > 0;
  const canSend = view !== null && !running && !blocked && screen.busy === null && props.disabledReason === null && screen.draft.trim() !== '';
  return (
    <div class="composer">
      {screen.problem !== null && <Problem problem={screen.problem} session={session} draft={screen.draft} busy={screen.busy !== null || props.disabledReason !== null} />}
      <div class="composer-box">
        <textarea
          aria-label="Message"
          placeholder={props.disabledReason ?? (running ? 'Wait for the reply, or stop it…' : 'Message the agent…')}
          value={screen.draft}
          rows={3}
          onInput={(event) => {
            session.setDraft(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (isSendPress(event, props.sendWith, PLATFORM)) {
              event.preventDefault();
              if (canSend) void session.send();
            }
          }}
        />
        <div class="composer-bar">
          <div class="toolbar">{props.toolbar}</div>
          {running ? (
            <button class="danger" disabled={screen.busy !== null} onClick={() => void session.stop()}>
              {screen.busy === 'stopping' ? 'Stopping…' : 'Stop'}
            </button>
          ) : (
            <button class="primary" disabled={!canSend} onClick={() => void session.send()}>
              {screen.busy === 'sending' ? 'Sending…' : 'Send'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
