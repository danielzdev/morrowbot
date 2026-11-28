import { useState } from 'preact/hooks';
import type { ProviderInstallCapability, ProviderInstallMode, ProviderInstallResult } from '../../bridge.ts';
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

/** "How to set up": short steps and the vendor's own page, for community providers or when no command can be shown safely. */
function Guide(props: { readonly providerId: string; readonly onOpenLink: (url: string) => Promise<string | null> }) {
  const guide = guideFor(props.providerId);
  const [error, setError] = useState<string | null>(null);
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
        <button
          type="button"
          class="btn ghost vendor-link"
          onClick={() => {
            setError(null);
            if (guide.link !== null) {
              void props.onOpenLink(guide.link.url).then((reason) => {
                setError(reason);
              });
            }
          }}
        >
          {guide.link.label} ↗
        </button>
      )}
      {error !== null && (
        <p class="status-problem" role="alert">
          {error}
        </p>
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

/** One-click Install / Update (or verified vendor Download button when no automated CLI installer exists) for built-in providers. */
function AutoInstallControls(props: {
  readonly mode: ProviderInstallMode;
  readonly capability: ProviderInstallCapability;
  readonly installing: ProviderInstallMode | null;
  readonly installDetail: string | null;
  readonly redact: (text: string) => string;
  readonly onInstall: (mode: ProviderInstallMode) => Promise<ProviderInstallResult>;
  readonly onCancelInstall: () => Promise<void>;
  readonly onOpenLink: (url: string) => Promise<string | null>;
}) {
  const [note, setNote] = useState<{ readonly kind: 'status' | 'error'; readonly text: string; readonly downloadUrl: string | null } | null>(null);
  const openDownload = (url: string): void => {
    setNote(null);
    void props.onOpenLink(url).then((reason) => {
      if (reason === null) setNote({ kind: 'status', text: 'Ori Bot rechecks when you come back.', downloadUrl: null });
      else setNote({ kind: 'error', text: props.redact(reason), downloadUrl: null });
    });
  };
  switch (props.capability.kind) {
    case 'download': {
      const { url } = props.capability;
      const buttonLabel = props.mode === 'update' ? 'Download update' : 'Download';
      return (
        <div class="one-click">
          <button
            type="button"
            class="btn primary"
            onClick={() => {
              openDownload(url);
            }}
          >
            {buttonLabel} ↗
          </button>
          {note !== null && (
            <span class={note.kind === 'error' ? 'status-problem' : 'muted'} role={note.kind === 'error' ? 'alert' : 'status'}>
              {note.text}
            </span>
          )}
        </div>
      );
    }
    case 'auto': {
      const verb = props.mode === 'update' ? 'Update' : 'Install';
      const busyLabel = props.mode === 'update' ? 'Updating…' : 'Installing…';
      const toolLabel = props.capability.tool === 'brew' ? 'Homebrew' : 'npm';
      const active = props.installing !== null;
      return (
        <div class="one-click">
          <button
            type="button"
            class="btn primary"
            disabled={active}
            onClick={() => {
              setNote(null);
              void props.onInstall(props.mode).then((result) => {
                switch (result.kind) {
                  case 'installed':
                    setNote(null);
                    break;
                  case 'cancelled':
                    setNote({ kind: 'status', text: props.mode === 'update' ? 'Update cancelled.' : 'Install cancelled.', downloadUrl: null });
                    break;
                  case 'failed':
                    setNote({ kind: 'error', text: props.redact(result.reason), downloadUrl: result.downloadUrl });
                    break;
                }
              });
            }}
          >
            <Icon name="terminal" />
            {active ? busyLabel : verb}
          </button>
          {active && (
            <button
              type="button"
              class="btn ghost"
              onClick={() => {
                void props.onCancelInstall();
              }}
            >
              Cancel
            </button>
          )}
          <span class={note?.kind === 'error' ? 'status-problem' : 'muted'} role={note?.kind === 'error' ? 'alert' : 'status'}>
            {active
              ? props.installDetail !== null
                ? props.redact(props.installDetail)
                : `${busyLabel} via ${toolLabel}.`
              : note !== null
                ? (
                  <>
                    {note.text}
                    {note.downloadUrl !== null && (
                      <>
                        {' '}
                        <button
                          type="button"
                          class="engine-note-link"
                          onClick={() => {
                            openDownload(note.downloadUrl ?? '');
                          }}
                        >
                          Download ↗
                        </button>
                      </>
                    )}
                  </>
                )
                : props.mode === 'update'
                  ? `Updates the official CLI via ${toolLabel} and rechecks automatically.`
                  : `Installs the official CLI via ${toolLabel} and rechecks automatically.`}
          </span>
        </div>
      );
    }
  }
}

/** Set up, sign in or update: what the provider needs before it can chat, ending with Recheck. */
export function ProviderSetup(props: {
  readonly providerId: string;
  readonly isBuiltin?: boolean;
  readonly setup: Setup;
  readonly info: AppInfo;
  readonly redact: (text: string) => string;
  readonly onCopy: (text: string) => Promise<void>;
  readonly onOpenLink: (url: string) => Promise<string | null>;
  readonly onSignInTerminal: (() => Promise<string | null>) | null;
  readonly installCapability?: ProviderInstallCapability | null;
  readonly installing?: ProviderInstallMode | null;
  readonly installDetail?: string | null;
  readonly onInstall?: ((mode: ProviderInstallMode) => Promise<ProviderInstallResult>) | null;
  readonly onCancelInstall?: (() => Promise<void>) | null;
}) {
  const { setup } = props;
  const builtin = props.isBuiltin ?? false;
  const installAction =
    (setup.kind === 'install' || setup.kind === 'update') && props.installCapability != null && props.onInstall != null && props.onCancelInstall != null ? (
      <AutoInstallControls
        mode={setup.kind}
        capability={props.installCapability}
        installing={props.installing ?? null}
        installDetail={props.installDetail ?? null}
        redact={props.redact}
        onInstall={props.onInstall}
        onCancelInstall={props.onCancelInstall}
        onOpenLink={props.onOpenLink}
      />
    ) : null;

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
      if (builtin) {
        return (
          <div class="setup">
            {installAction ?? <p>{props.redact(setup.text)}</p>}
          </div>
        );
      }
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
            Ori Bot found version <span class="mono">{props.redact(setup.found)}</span> and needs <span class="mono">{props.redact(setup.supported)}</span>.
          </p>
          {installAction}
          {!builtin && <Guide providerId={props.providerId} onOpenLink={props.onOpenLink} />}
        </div>
      );
  }
}
