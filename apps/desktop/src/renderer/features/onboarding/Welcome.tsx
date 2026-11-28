import { useState } from 'preact/hooks';
import type { EngineRow } from '../../shared/engine-setup.ts';
import type { Loadable } from '../../shared/store.ts';
import { SetupChecklist, type EngineActions } from './SetupChecklist.tsx';

export interface WelcomeProps {
  readonly engines: Loadable<readonly EngineRow[]>;
  readonly actions: EngineActions;
  /** The engine New Agent will start on (the §5.1 prefill rule), or null when none qualifies. */
  readonly firstEngine: string | null;
  /** Step 2: New Agent, prefilled. */
  readonly onCreate: () => void;
  /** "Skip for now": New Agent as an unbound draft. */
  readonly onSkip: () => void;
  /** Opens the setup guide in the browser; resolves to an error message, or null when opened. */
  readonly onOpenGuide: () => Promise<string | null>;
}

/**
 * First launch, no agents yet (spec §7): two steps to a first chat. Step 1 shows the engines and
 * what each needs; step 2 opens New Agent. Neither step blocks the other.
 */
export function Welcome(props: WelcomeProps) {
  const [guideError, setGuideError] = useState<string | null>(null);
  const rows = props.engines.kind === 'loaded' ? props.engines.value : [];
  const ready = rows.filter((row) => row.ready).length;
  return (
    <div class="welcome">
      <header class="welcome-hero">
        <h2 class="welcome-title">Welcome to MorrowBot</h2>
        <p class="welcome-lede">A calm home for your AI agents. Two steps to your first chat.</p>
      </header>
      <section class="welcome-step" aria-labelledby="welcome-step-1">
        <div class="welcome-step-head">
          <span class="step-number" aria-hidden="true">1</span>
          <h3 id="welcome-step-1">Your AI engines</h3>
          {props.engines.kind === 'loaded' && (
            <span class="welcome-count">
              {ready} of {rows.length} ready
            </span>
          )}
        </div>
        <p class="welcome-note">MorrowBot uses the AI tools already on this computer. One ready engine is enough.</p>
        <SetupChecklist engines={props.engines} actions={props.actions} />
      </section>
      <section class="welcome-step" aria-labelledby="welcome-step-2">
        <div class="welcome-step-head">
          <span class="step-number" aria-hidden="true">2</span>
          <h3 id="welcome-step-2">Meet your first agent</h3>
        </div>
        <p class="welcome-note">
          {props.firstEngine === null
            ? 'No engine is ready yet. Your agent can start without one and pick it later.'
            : `Give it a name and a look. It starts on ${props.firstEngine}; you can change that any time.`}
        </p>
        <div class="welcome-actions">
          <button type="button" class="btn primary" onClick={props.onCreate}>
            Create your first agent
          </button>
          <button type="button" class="btn ghost" onClick={props.onSkip}>
            Skip for now
          </button>
        </div>
      </section>
      <div class="welcome-footer">
        <p>
          Stuck?{' '}
          <button
            type="button"
            class="btn ghost"
            aria-label="Read the setup guide, opens in your browser"
            onClick={() => {
              setGuideError(null);
              void props.onOpenGuide().then((reason) => {
                setGuideError(reason);
              });
            }}
          >
            Read the setup guide ↗
          </button>
        </p>
        {guideError !== null && (
          <p class="welcome-footer-error" role="alert">
            {guideError}
          </p>
        )}
      </div>
    </div>
  );
}
