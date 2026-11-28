import { useState } from 'preact/hooks';
import type { ProviderInstallResult } from '../../bridge.ts';
import type { EngineRow, EngineTone } from '../../shared/engine-setup.ts';
import type { Loadable } from '../../shared/store.ts';
import { Icon } from '../../shared/ui/Icon.tsx';

/** What the checklist's buttons do; the app owns each one. */
export interface EngineActions {
  /** Opens Terminal with the engine's own sign-in command; resolves to why it could not, or null. */
  readonly signIn: (id: string) => Promise<string | null>;
  readonly copy: (id: string, text: string) => Promise<void>;
  /** Opens a verified external download or setup link; resolves to an error message, or null when opened. */
  readonly openGuide: (id: string, url: string) => Promise<string | null>;
  /** Runs the allowlisted 1-click installer and rechecks on success so the row flips straight to Sign in or Ready. */
  readonly install: (id: string) => Promise<ProviderInstallResult>;
  readonly cancelInstall: (id: string) => Promise<void>;
  readonly recheck: (id: string) => void;
  readonly turnOn: (id: string) => void;
}

type RowNote =
  | { readonly kind: 'status'; readonly text: string }
  | { readonly kind: 'error'; readonly text: string; readonly downloadUrl: string | null };

/** One calm status indicator on the left: green check when ready, subtle dot otherwise (no duplicate warning triangle + yellow badge). */
function EngineIndicator(props: { readonly tone: EngineTone }) {
  switch (props.tone) {
    case 'ok':
      return (
        <span class="engine-indicator ok" aria-hidden="true">
          <Icon name="check" size={15} />
        </span>
      );
    case 'muted':
      return (
        <span class="engine-indicator muted" aria-hidden="true">
          <span class="status-dot muted" />
        </span>
      );
    case 'warning':
      return (
        <span class="engine-indicator warning" aria-hidden="true">
          <span class="status-dot warn" />
        </span>
      );
    case 'error':
      return (
        <span class="engine-indicator error" aria-hidden="true">
          <span class="status-dot danger" />
        </span>
      );
  }
}

/** The one action a not-ready engine gets, and any inline status or error note below the row. */
function EngineAction(props: { readonly row: EngineRow; readonly actions: EngineActions }) {
  const { row, actions } = props;
  const [note, setNote] = useState<RowNote | null>(null);

  const openExternal = (url: string): void => {
    void actions.openGuide(row.id, url).then((reason) => {
      if (reason === null) setNote({ kind: 'status', text: 'MorrowBot rechecks when you come back.' });
      else setNote({ kind: 'error', text: reason, downloadUrl: null });
    });
  };

  const button = (label: string, run: () => void, options: { readonly primary: boolean; readonly external: boolean; readonly describedBy: boolean }) => (
    <button
      type="button"
      class={`btn ${options.primary ? 'primary' : 'secondary'}`}
      disabled={row.busy}
      aria-describedby={options.describedBy ? `engine-note-${row.id}` : undefined}
      aria-label={`${label}, ${row.name}${options.external ? ', opens in your browser' : ''}`}
      onClick={run}
    >
      {row.busy ? 'Checking…' : `${label}${options.external ? ' ↗' : ''}`}
    </button>
  );

  const plain = { primary: false, external: false, describedBy: false };

  const control = (() => {
    if (row.installing) {
      return (
        <>
          <button type="button" class="btn secondary" disabled>
            Installing…
          </button>
          <button
            type="button"
            class="btn ghost"
            aria-label={`Cancel install, ${row.name}`}
            onClick={() => {
              void actions.cancelInstall(row.id);
            }}
          >
            Cancel
          </button>
        </>
      );
    }
    switch (row.action.kind) {
      case 'none':
        return null;
      case 'install': {
        const { downloadUrl } = row.action;
        return button('Install', () => {
          setNote(null);
          void actions.install(row.id).then((result) => {
            switch (result.kind) {
              case 'installed':
                setNote(null);
                break;
              case 'cancelled':
                setNote({ kind: 'status', text: 'Install cancelled.' });
                break;
              case 'failed':
                setNote({ kind: 'error', text: result.reason, downloadUrl: result.downloadUrl ?? downloadUrl });
                break;
            }
          });
        }, plain);
      }
      case 'sign-in-terminal':
        return button('Sign in', () => {
          setNote({ kind: 'status', text: 'Opening Terminal…' });
          void actions.signIn(row.id).then((reason) => {
            setNote(
              reason === null
                ? { kind: 'status', text: 'Finish signing in in Terminal, then come back here.' }
                : { kind: 'error', text: reason, downloadUrl: null },
            );
          });
        }, { ...plain, primary: true });
      case 'copy': {
        const { text } = row.action;
        return button('Copy command', () => {
          void actions.copy(row.id, text).then(() => {
            setNote({ kind: 'status', text: 'Copied. Run it in a terminal, then come back here.' });
          });
        }, { ...plain, describedBy: true });
      }
      case 'guide': {
        const { label, url } = row.action;
        return button(label, () => {
          openExternal(url);
        }, { ...plain, external: true });
      }
      case 'recheck':
        return button('Recheck', () => {
          actions.recheck(row.id);
        }, plain);
      case 'turn-on':
        return button('Turn on', () => {
          actions.turnOn(row.id);
        }, plain);
    }
  })();

  return (
    <>
      <div class="engine-action">{control}</div>
      {row.action.kind === 'copy' && (
        <code id={`engine-note-${row.id}`} class="engine-command mono">
          {row.action.text}
        </code>
      )}
      {row.installing && row.progress !== null && (
        <p class="engine-note" role="status">
          {row.progress}
        </p>
      )}
      {!row.installing && note === null && row.note != null && <p class="engine-note">{row.note}</p>}
      {!row.installing && note !== null && (
        <p class={`engine-note${note.kind === 'error' ? ' error' : ''}`} role={note.kind === 'error' ? 'alert' : 'status'}>
          {note.text}
          {note.kind === 'error' && note.downloadUrl !== null && (
            <>
              {' '}
              <button
                type="button"
                class="engine-note-link"
                onClick={() => {
                  openExternal(note.downloadUrl ?? '');
                }}
              >
                Download ↗
              </button>
            </>
          )}
        </p>
      )}
    </>
  );
}

/** Step 1 of first run (spec §7): the built-in engines, their live status, and one calm action each when not ready. */
export function SetupChecklist(props: { readonly engines: Loadable<readonly EngineRow[]>; readonly actions: EngineActions }) {
  const { engines } = props;
  switch (engines.kind) {
    case 'loading':
      return <p class="muted">Looking for AI engines on this computer…</p>;
    case 'failed':
      return (
        <p class="muted" role="alert">
          MorrowBot couldn't check its AI engines. {engines.message}
        </p>
      );
    case 'loaded':
      return (
        <ul class="engine-list" aria-label="Your AI engines">
          {engines.value.map((row) => (
            <li key={row.id} class="engine-row">
              <EngineIndicator tone={row.tone} />
              <span class="engine-name">{row.name}</span>
              <span class={`engine-status ${row.tone}`}>{row.status}</span>
              <EngineAction row={row} actions={props.actions} />
            </li>
          ))}
        </ul>
      );
  }
}
