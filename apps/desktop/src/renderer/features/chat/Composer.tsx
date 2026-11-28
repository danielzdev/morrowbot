import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../../shared/ui/Icon.tsx';
import type { SendWith } from '../../shared/chat-prefs.ts';
import { isSendPress, PLATFORM } from '../../shared/keys.ts';
import { useStore } from '../../shared/use-store.ts';
import { AttachmentStrip } from './AttachmentStrip.tsx';
import { ComposerBanners } from './ComposerBanners.tsx';
import { QueueList } from './QueueList.tsx';
import { ACCEPT, readFiles } from './read-files.ts';
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
  const items = useStore(session.attachments.items);
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const attach = (files: Iterable<File>): void => {
    void readFiles(files).then((picked) => {
      if (picked.length > 0) session.attachments.add(picked);
    });
  };
  useLayoutEffect(() => {
    if (box.current !== null) fit(box.current);
  }, [screen.draft]);
  const view = screen.view.kind === 'loaded' ? screen.view.value : null;
  const running = view?.activeTurn != null;
  const blocked = (view?.blockedGroups.length ?? 0) > 0;
  const disabledReason = props.disabledReason ?? (screen.connection === 'reconnecting' ? RECONNECTING : null);
  const uploading = items.some((item) => item.kind === 'uploading');
  const files = items.some((item) => item.kind === 'ready');
  const hasContent = screen.draft.trim() !== '' || files;
  const canSend = view !== null && !blocked && screen.busy === null && disabledReason === null && hasContent && !uploading;
  const sendLabel =
    screen.busy === 'sending' ? 'Sending…' : uploading ? 'Uploading files…' : running ? 'Queue: sent after this reply' : 'Send';
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
      <div
        class={`composer-box${dropping ? ' dropping' : ''}`}
        onDragOver={(event) => {
          if (!event.dataTransfer?.types.includes('Files')) return;
          event.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => { setDropping(false); }}
        onDrop={(event) => {
          setDropping(false);
          const files = event.dataTransfer?.files;
          if (files === undefined || files.length === 0) return;
          event.preventDefault();
          attach(files);
        }}
      >
        <AttachmentStrip items={items} onRemove={(key) => { session.attachments.remove(key); }} />
        <textarea
          ref={box}
          aria-label="Message"
          placeholder={running ? `Queue a message: ${props.agentName} sees it after this reply, or when you Steer now…` : `Message ${props.agentName}…`}
          value={screen.draft}
          rows={1}
          onInput={(event) => {
            session.setDraft(event.currentTarget.value);
          }}
          onPaste={(event) => {
            const files = event.clipboardData?.files;
            if (files === undefined || files.length === 0) return;
            event.preventDefault();
            attach(files);
          }}
          onKeyDown={(event) => {
            if (isSendPress(event, props.sendWith, PLATFORM)) {
              event.preventDefault();
              if (canSend) void session.send();
            }
          }}
        />
        <div class="composer-bar">
          <input
            ref={picker}
            type="file"
            multiple
            accept={ACCEPT}
            hidden
            onChange={(event) => {
              const { files } = event.currentTarget;
              if (files !== null) attach(files);
              event.currentTarget.value = '';
            }}
          />
          <button class="icon-btn attach" aria-label="Attach files" title="Attach images or text files" onClick={() => picker.current?.click()}>
            <Icon name="paperclip" />
          </button>
          <div class="toolbar">{props.toolbar}</div>
          {disabledReason !== null && <span class="composer-reason">{disabledReason}</span>}
          <div class="composer-sends">
            {running && (
              <button class="round-btn stop" aria-label={screen.busy === 'stopping' ? 'Stopping…' : 'Stop'} title="Stop" disabled={screen.busy !== null || screen.connection !== 'live'} onClick={() => void session.stop()}>
                <Icon name="stop" />
              </button>
            )}
            {(!running || hasContent) && (
              <button class="round-btn send" aria-label={sendLabel} title={sendLabel} disabled={!canSend} onClick={() => void session.send()}>
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
