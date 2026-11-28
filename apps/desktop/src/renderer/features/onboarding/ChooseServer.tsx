import { useEffect, useRef, useState } from 'preact/hooks';
import { JoinServerForm, type JoinFields } from '../../shared/ui/JoinServerForm.tsx';

const JOIN_NOTE =
  "Use agents someone shared with you, or your own server on another computer. No server runs here, and the server never sees this computer's files, terminal or screen.";

export interface ChooseServerProps {
  /** Starts this computer's own server; answers a problem to show, or null once it runs. */
  readonly onStart: () => Promise<string | null>;
  /** Joins a server and starts none here; answers a problem to show, or null once connected. */
  readonly onJoin: (fields: JoinFields) => Promise<string | null>;
}

/**
 * The very first screen, before any server runs: start one on this computer, or join one. Joining runs nothing
 * here, and the server it joins never reaches this computer's files, terminal or screen. The join form opens
 * on its own screen so each screen asks one thing.
 */
export function ChooseServer(props: ChooseServerProps) {
  const [starting, setStarting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    title.current?.focus();
  }, [joining]);
  return (
    <div class="welcome choose-server">
      <div class="choose-drag drag" aria-hidden="true" />
      <header class="welcome-hero">
        <h2 class="welcome-title" ref={title} tabIndex={-1}>
          {joining ? 'Join a server' : 'Welcome to MorrowBot'}
        </h2>
        <p class="welcome-lede">
          {joining
            ? JOIN_NOTE
            : 'Where should your agents live? You can change this later in Settings › Server.'}
        </p>
      </header>
      {joining ? (
        <section class="welcome-step" aria-label="Join a server">
          <JoinServerForm
            onJoin={props.onJoin}
            onCancel={() => {
              setJoining(false);
            }}
          />
        </section>
      ) : (
        <>
          <section class="welcome-step" aria-labelledby="choose-own">
            <div class="welcome-step-head">
              <h3 id="choose-own">Start my own server</h3>
            </div>
            <p class="welcome-note">Your agents run on this computer. You can invite other people to some or all of them later.</p>
            {problem !== null && (
              <p class="join-error" role="alert">
                {problem}
              </p>
            )}
            <div class="welcome-actions">
              <button
                type="button"
                class="btn primary"
                disabled={starting}
                onClick={() => {
                  setStarting(true);
                  void props.onStart().then((answer) => {
                    setStarting(false);
                    setProblem(answer);
                  });
                }}
              >
                {starting ? 'Starting…' : 'Start my own server'}
              </button>
            </div>
          </section>
          <section class="welcome-step" aria-labelledby="choose-join">
            <div class="welcome-step-head">
              <h3 id="choose-join">Join a server</h3>
            </div>
            <p class="welcome-note">{JOIN_NOTE}</p>
            <div class="welcome-actions">
              <button
                type="button"
                class="btn secondary"
                disabled={starting}
                onClick={() => {
                  setJoining(true);
                }}
              >
                Join a server
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
