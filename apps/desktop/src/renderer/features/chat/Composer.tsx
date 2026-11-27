import type { ComponentChildren } from 'preact';
import type { SendWith } from '../../shared/chat-prefs.ts';
import { isSendPress, PLATFORM } from '../../shared/keys.ts';
import { useStore } from '../../shared/use-store.ts';
import { ComposerBanners } from './ComposerBanners.tsx';
import type { ThreadSession } from './thread-session.ts';

/** Why Send waits while the host can't be reached; the draft stays. */
const RECONNECTING = 'Reconnecting to MorrowBot… your message is kept.';

/** The message box. `toolbar` holds the agent's model and access pickers; `sendWith` is Settings › Chat › Send with. */
export function Composer(props: {
  readonly session: ThreadSession;
  readonly toolbar: ComponentChildren;
  readonly disabledReason: string | null;
  readonly sendWith: SendWith;
  /** Host text made safe to show (spec §9.1), or null when it can't be. */
  readonly safe: (text: string) => string | null;
  readonly onOpenProviders: () => void;
}) {
  const { session } = props;
  const screen = useStore(session.screen);
  const view = screen.view.kind === 'loaded' ? screen.view.value : null;
  const running = view?.activeTurn != null;
  const blocked = (view?.blockedGroups.length ?? 0) > 0;
  const disabledReason = props.disabledReason ?? (screen.connection === 'reconnecting' ? RECONNECTING : null);
  const canSend = view !== null && !running && !blocked && screen.busy === null && disabledReason === null && screen.draft.trim() !== '';
  return (
    <div class="composer">
      <ComposerBanners
        problem={screen.problem}
        session={session}
        draft={screen.draft}
        busy={screen.busy !== null || disabledReason !== null}
        safe={props.safe}
        onOpenProviders={props.onOpenProviders}
      />
      <div class="composer-box">
        <textarea
          aria-label="Message"
          placeholder={disabledReason ?? (running ? 'Wait for the reply, or stop it…' : 'Message the agent…')}
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
            <button class="danger" disabled={screen.busy !== null || screen.connection !== 'live'} onClick={() => void session.stop()}>
              {screen.busy === 'stopping' ? 'Stopping…' : 'Stop'}
            </button>
          ) : (
            <button class="primary" disabled={!canSend} aria-label={disabledReason === null ? undefined : `Send (${disabledReason})`} onClick={() => void session.send()}>
              {screen.busy === 'sending' ? 'Sending…' : 'Send'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
