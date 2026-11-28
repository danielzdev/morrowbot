import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { EngineRow } from '../../shared/engine-setup.ts';
import type { Loadable } from '../../shared/store.ts';
import { SetupChecklist, type EngineActions } from './SetupChecklist.tsx';

export interface WelcomeProps {
  readonly engines: Loadable<readonly EngineRow[]>;
  readonly actions: EngineActions;
  /** The engine New Agent will start on (the §5.1 prefill rule), or null when none qualifies. */
  readonly firstEngine: string | null;
  /** New Agent, prefilled. */
  readonly onCreate: () => void;
  /** New Agent as an unbound draft. */
  readonly onSkip: () => void;
  /** Opens the setup guide in the browser; resolves to an error message, or null when opened. */
  readonly onOpenGuide: () => Promise<string | null>;
}

type Step = 'engines' | 'agent';

/**
 * First launch, no agents yet (spec §7): one decision per screen. Step 1 shows the engines and what each needs;
 * step 2 opens New Agent. Only the person moves between steps; nothing advances by itself.
 */
export function Welcome(props: WelcomeProps) {
  const [step, setStep] = useState<Step>('engines');
  const title = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    title.current?.focus();
  }, [step]);
  switch (step) {
    case 'engines':
      return (
        <EnginesStep
          {...props}
          title={title}
          onNext={() => {
            setStep('agent');
          }}
        />
      );
    case 'agent':
      return (
        <div class="welcome">
          <header class="welcome-hero">
            <p class="welcome-progress">Step 2 of 2</p>
            <h2 class="welcome-title" ref={title} tabIndex={-1}>
              Meet your first agent
            </h2>
            <p class="welcome-lede">
              {props.firstEngine === null
                ? 'Your agent can start without a default engine. You can choose one later.'
                : `Give it a name and a look. It starts on ${props.firstEngine}; you can change that any time.`}
            </p>
          </header>
          <div class="welcome-nav">
            <button
              type="button"
              class="btn ghost"
              onClick={() => {
                setStep('engines');
              }}
            >
              Back
            </button>
            <div class="welcome-actions">
              <button type="button" class="btn ghost" onClick={props.onSkip}>
                Create without a default engine
              </button>
              <button type="button" class="btn primary" onClick={props.onCreate}>
                Create your first agent
              </button>
            </div>
          </div>
        </div>
      );
  }
}

function EnginesStep(props: WelcomeProps & { readonly title: RefObject<HTMLHeadingElement | null>; readonly onNext: () => void }) {
  const [guideError, setGuideError] = useState<string | null>(null);
  const rows = props.engines.kind === 'loaded' ? props.engines.value : [];
  const ready = rows.filter((row) => row.ready).length;
  return (
    <div class="welcome">
      <header class="welcome-hero">
        <p class="welcome-progress">Step 1 of 2</p>
        <h2 class="welcome-title" ref={props.title} tabIndex={-1}>
          Connect an AI engine
        </h2>
        <p class="welcome-lede">Ori Bot uses the AI tools already on this computer. One is enough.</p>
      </header>
      <section class="welcome-step" aria-label="Your AI engines">
        {props.engines.kind === 'loaded' && (
          <span class="welcome-count">
            {ready} of {rows.length} ready
          </span>
        )}
        <SetupChecklist engines={props.engines} actions={props.actions} />
      </section>
      <div class="welcome-nav">
        <p class="welcome-status" role="status">
          {props.firstEngine === null ? '' : `A default engine is ready: ${props.firstEngine}.`}
        </p>
        <button type="button" class={`btn ${props.firstEngine === null ? 'ghost' : 'primary'}`} onClick={props.onNext}>
          {props.firstEngine === null ? 'Continue without a default engine' : 'Continue'}
        </button>
      </div>
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
