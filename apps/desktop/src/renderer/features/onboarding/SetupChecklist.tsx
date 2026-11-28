import { useState } from 'preact/hooks';
import type { EngineRow, EngineTone } from '../../shared/engine-setup.ts';
import type { Loadable } from '../../shared/store.ts';
import { Icon, type IconName } from '../../shared/ui/Icon.tsx';
import { Pill } from '../../shared/ui/ListDetail.tsx';

/** What the checklist's buttons do; the app owns each one. */
export interface EngineActions {
  /** Opens Terminal with the engine's own sign-in command; resolves to why it could not, or null. */
  readonly signIn: (id: string) => Promise<string | null>;
  readonly copy: (id: string, text: string) => Promise<void>;
  readonly openGuide: (id: string, url: string) => void;
  readonly recheck: (id: string) => void;
  readonly turnOn: (id: string) => void;
}

const ICON: Readonly<Record<EngineTone, IconName>> = { ok: 'check', muted: 'info', warning: 'warning', error: 'warning' };

/** The one button a not-ready engine gets, and the note it leaves behind. */
function EngineAction(props: { readonly row: EngineRow; readonly actions: EngineActions }) {
  const { row, actions } = props;
  const [note, setNote] = useState<string | null>(null);
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
    switch (row.action.kind) {
      case 'none':
        return null;
      case 'sign-in-terminal':
        return button('Sign in', () => {
          setNote('Opening Terminal…');
          void actions.signIn(row.id).then((reason) => {
            setNote(reason ?? 'Finish signing in in Terminal, then come back here.');
          });
        }, { ...plain, primary: true });
      case 'copy': {
        const { text } = row.action;
        return button('Copy command', () => {
          void actions.copy(row.id, text).then(() => {
            setNote('Copied. Run it in a terminal, then come back here.');
          });
        }, { ...plain, describedBy: true });
      }
      case 'guide': {
        const { label, url } = row.action;
        return button(label, () => {
          actions.openGuide(row.id, url);
          setNote('MorrowBot rechecks when you come back.');
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
      {note !== null && (
        <p class="engine-note" role="status">
          {note}
        </p>
      )}
    </>
  );
}

/** Step 1 of first run (spec §7): the built-in engines, their live status, and one action each when not ready. */
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
              <span class={`engine-icon ${row.tone}`} aria-hidden="true">
                <Icon name={ICON[row.tone]} />
              </span>
              <span class="engine-name">{row.name}</span>
              <Pill tone={row.tone}>{row.status}</Pill>
              <EngineAction row={row} actions={props.actions} />
            </li>
          ))}
        </ul>
      );
  }
}
