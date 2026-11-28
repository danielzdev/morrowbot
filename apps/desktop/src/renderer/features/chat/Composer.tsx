import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { Icon } from '../../shared/ui/Icon.tsx';
import type { SendWith } from '../../shared/chat-prefs.ts';
import { isSendPress, PLATFORM } from '../../shared/keys.ts';
import { useStore } from '../../shared/use-store.ts';
import { ComposerBanners } from './ComposerBanners.tsx';
import { QueueList } from './QueueList.tsx';
import type { ThreadSession } from './thread-session.ts';

/** Why Send waits while the host can't be reached; the draft stays. */
const RECONNECTING = 'Reconnecting to MorrowBot… your message is kept.';

const MAX_LINES = 12;

/** Grows the box with its text, from one line up to twelve. */
function fit(box: HTMLTextAreaElement): void {
  box.style.height = 'auto';
  const line = Number.parseFloat(getComputedStyle(box).lineHeight) || 22;
  box.style.height = `${String(Math.min(box.scrollHeight, line * MAX_LINES))}px`;
}

/**
 * The message box (spec §4.5). `toolbar` holds the binding and access pills, `notes` the warning
 * strip shown under it while a warning applies. `sendWith` is Settings › Chat › Send with.
 */
export function Composer(props: {
  readonly session: ThreadSession;
  readonly agentName: string;
  readonly toolbar: ComponentChildren;
  readonly notes?: ComponentChildren;
  readonly disabledReason: string | null;
  readonly sendWith: SendWith;
  /** Host text made safe to show (spec §9.1), or null when it can't be. */
  readonly safe: (text: string) => string | null;
  readonly onOpenProviders: () => void;
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
  const disabledReason = props.disabledReason ?? (screen.connection === 'reconnecting' ? RECONNECTING : null);
  const canSend = view !== null && !blocked && screen.busy === null && disabledReason === null && screen.draft.trim() !== '';
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
      {view !== null && <QueueList session={session} view={view} screen={screen} agentName={props.agentName} />}
      <div class="composer-box">
        <textarea
          ref={box}
          aria-label="Message"
          placeholder={running ? `Queue a message: ${props.agentName} sees it after this reply, or when you Steer now…` : `Message ${props.agentName}…`}
          value={screen.draft}
          rows={1}
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
          {disabledReason !== null && <span class="composer-reason">{disabledReason}</span>}
          <div class="composer-sends">
            {running && (
              <button class="round-btn stop" aria-label={screen.busy === 'stopping' ? 'Stopping…' : 'Stop'} title="Stop" disabled={screen.busy !== null || screen.connection !== 'live'} onClick={() => void session.stop()}>
                <Icon name="stop" />
              </button>
            )}
            {(!running || screen.draft.trim() !== '') && (
              <button
                class="round-btn send"
                aria-label={screen.busy === 'sending' ? 'Sending…' : running ? 'Queue' : 'Send'}
                title={running ? 'Queue: sent after this reply' : 'Send'}
                disabled={!canSend}
                onClick={() => void session.send()}
              >
                <Icon name="send" />
              </button>
            )}
          </div>
        </div>
      </div>
      {props.notes}
    </div>
  );
}
