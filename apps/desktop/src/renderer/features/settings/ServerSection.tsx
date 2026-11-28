import { useState } from 'preact/hooks';
import type { ServerMode, ServerRequest } from '../../bridge.ts';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { JoinServerForm } from '../../shared/ui/JoinServerForm.tsx';
import { ROWS } from './settings-index.ts';
import { SettingRow } from './SettingRow.tsx';

/**
 * Settings › Server: whether this app runs its own server or uses one it joined, and switching between them.
 * Switching saves the choice and reopens MorrowBot; this computer's own agents stay in its data folder either way.
 */
export function ServerSection(props: {
  readonly server: Exclude<ServerMode, { kind: 'choosing' }>;
  /** Answers a problem to show, or null once MorrowBot is reopening on the new server. */
  readonly onChoose: (request: ServerRequest) => Promise<string | null>;
}) {
  const [joining, setJoining] = useState(false);
  const [confirmLocal, setConfirmLocal] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { server } = props;
  const startLocal = async (): Promise<void> => {
    setConfirmLocal(false);
    setProblem(await props.onChoose({ kind: 'local' }));
  };
  return (
    <>
      <SettingRow entry={ROWS.server}>
        <span class="setting-note" role="status">
          {server.kind === 'local' ? 'Running on this computer' : `Joined ${server.hostName}`}
        </span>
      </SettingRow>
      <div class="pair-panel server-panel">
        <div class="pair-info">
          {server.kind === 'local' ? (
            <p class="setting-description">Your agents run on this computer. Invite people under Members, or pair a phone under Devices.</p>
          ) : (
            <>
              <code class="invite-link">{server.url}</code>
              <p class="setting-description">
                This app runs no server of its own. The server can't reach this computer's files, terminal or screen.
              </p>
            </>
          )}
          {problem !== null && (
            <p class="pair-error" role="alert">
              {problem}
            </p>
          )}
          {joining ? (
            <JoinServerForm
              onJoin={(fields) => props.onChoose({ kind: 'join', ...fields })}
              onCancel={() => {
                setJoining(false);
              }}
            />
          ) : (
            <div class="pair-actions">
              {server.kind === 'remote' && (
                <button
                  type="button"
                  class="btn primary"
                  onClick={() => {
                    setConfirmLocal(true);
                  }}
                >
                  Start my own server
                </button>
              )}
              <button
                type="button"
                class="btn secondary"
                onClick={() => {
                  setProblem(null);
                  setJoining(true);
                }}
              >
                {server.kind === 'local' ? 'Join a server instead…' : 'Join a different server…'}
              </button>
            </div>
          )}
        </div>
      </div>
      {confirmLocal && (
        <ConfirmDialog
          title="Start your own server?"
          body={<p>MorrowBot reopens with a server on this computer. To come back to {server.kind === 'remote' ? server.hostName : 'this server'}, you will need a new invite.</p>}
          confirmLabel="Start my own server"
          tone="primary"
          onConfirm={() => void startLocal()}
          onCancel={() => {
            setConfirmLocal(false);
          }}
        />
      )}
    </>
  );
}
