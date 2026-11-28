import { useState } from 'preact/hooks';
import { JoinServerForm, type JoinFields } from '../../shared/ui/JoinServerForm.tsx';

export interface ChooseServerProps {
  /** Starts this computer's own server; answers a problem to show, or null once it runs. */
  readonly onStart: () => Promise<string | null>;
  /** Joins a server and starts none here; answers a problem to show, or null once connected. */
  readonly onJoin: (fields: JoinFields) => Promise<string | null>;
}

/**
 * The very first screen, before any server runs: start one on this computer, or join one. Joining runs nothing
 * here, and the server it joins never reaches this computer's files, terminal or screen.
 */
export function ChooseServer(props: ChooseServerProps) {
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div class="welcome">
      <div class="choose-drag drag" aria-hidden="true" />
      <header class="welcome-hero">
        <h2 class="welcome-title">Welcome to MorrowBot</h2>
        <p class="welcome-lede">Where should your agents live? You can change this later in Settings › Server.</p>
      </header>
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
        <p class="welcome-note">
          Use agents someone shared with you, or your own server on another computer. No server runs here, and the server never sees this computer's
          files, terminal or screen.
        </p>
        <JoinServerForm onJoin={props.onJoin} />
      </section>
    </div>
  );
}
