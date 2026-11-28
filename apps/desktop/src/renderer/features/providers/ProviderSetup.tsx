import { useState } from 'preact/hooks';
import type { AppInfo } from '../../shared/privacy.ts';
import { Icon } from '../../shared/ui/Icon.tsx';
import { AFTER_SETUP, guideFor } from './provider-guides.ts';
import type { ProviderSetup as Setup } from './provider-status.ts';
import { setupCommand } from './setup-command.ts';

/** A command to run, in a mono box with Copy, then "press Recheck" (spec §6.2). */
function CommandBox(props: { readonly text: string; readonly onCopy: (text: string) => Promise<void> }) {
  const [copied, setCopied] = useState(false);
  return (
    <div class="command-box">
      <code class="mono">{props.text}</code>
      <button
        type="button"
        class="btn secondary"
        onClick={() => {
          void props.onCopy(props.text).then(() => {
            setCopied(true);
          });
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} />
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/** "How to set up": short steps and the vendor's own page, for when no command can be shown safely. */
function Guide(props: { readonly providerId: string; readonly onOpenLink: (url: string) => void }) {
  const guide = guideFor(props.providerId);
  return (
    <div class="setup-guide">
      <div class="setup-guide-title">How to set up</div>
      <ol>
        {guide.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
        <li>{AFTER_SETUP}</li>
      </ol>
      {guide.link !== null && (
        <button type="button" class="btn ghost vendor-link" onClick={() => { if (guide.link !== null) props.onOpenLink(guide.link.url); }}>
          {guide.link.label} ↗
        </button>
      )}
    </div>
  );
}

/** One-click sign-in (spec §6.2 #29 polish): Terminal opens with the provider's own command; the copy box stays as the fallback. */
function SignInButton(props: { readonly onSignIn: () => Promise<string | null> }) {
  const [state, setState] = useState<{ readonly kind: 'idle' | 'opening' | 'opened' } | { readonly kind: 'failed'; readonly reason: string }>({ kind: 'idle' });
  return (
    <div class="one-click">
      <button
        type="button"
        class="btn primary"
        disabled={state.kind === 'opening'}
        onClick={() => {
          setState({ kind: 'opening' });
          void props.onSignIn().then((reason) => {
            setState(reason === null ? { kind: 'opened' } : { kind: 'failed', reason });
          });
        }}
      >
        <Icon name="keyboard" />
        Sign in with Terminal
      </button>
      <span class="muted" role="status">
        {state.kind === 'opened' ? 'Terminal is open. Finish signing in there, then come back.' : state.kind === 'failed' ? state.reason : "Opens Terminal with the provider's own sign-in command."}
      </span>
    </div>
  );
}

/** Set up, sign in or update: what the provider needs before it can chat, ending with Recheck. */
export function ProviderSetup(props: {
  readonly providerId: string;
  readonly setup: Setup;
  readonly info: AppInfo;
  readonly redact: (text: string) => string;
  readonly onCopy: (text: string) => Promise<void>;
  readonly onOpenLink: (url: string) => void;
  readonly onSignInTerminal: (() => Promise<string | null>) | null;
}) {
  const { setup } = props;
  switch (setup.kind) {
    case 'sign-in': {
      const command = setupCommand(setup.argv, props.info);
      const oneClick = props.onSignInTerminal === null ? null : <SignInButton onSignIn={props.onSignInTerminal} />;
      if (command.kind === 'guide') {
        return (
          <div class="setup">
            {oneClick}
            <Guide providerId={props.providerId} onOpenLink={props.onOpenLink} />
          </div>
        );
      }
      return (
        <div class="setup">
          {oneClick}
          <p>{oneClick === null ? 'Run this in a terminal to sign in:' : 'Or run it yourself in a terminal:'}</p>
          <CommandBox text={command.text} onCopy={props.onCopy} />
          <p class="muted">{AFTER_SETUP}</p>
        </div>
      );
    }
    case 'install':
      return (
        <div class="setup">
          <p>{props.redact(setup.text)}</p>
          <Guide providerId={props.providerId} onOpenLink={props.onOpenLink} />
        </div>
      );
    case 'update':
      return (
        <div class="setup">
          <p>
            MorrowBot found version <span class="mono">{props.redact(setup.found)}</span> and needs <span class="mono">{props.redact(setup.supported)}</span>. Update the CLI, then press Recheck.
          </p>
          <Guide providerId={props.providerId} onOpenLink={props.onOpenLink} />
        </div>
      );
  }
}
