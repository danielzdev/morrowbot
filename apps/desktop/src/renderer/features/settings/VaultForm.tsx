import type { VaultItem, VaultItemKind } from '@morrowbot/contracts';
import { useState } from 'preact/hooks';
import { Icon } from '../../shared/ui/Icon.tsx';
import { Segmented } from '../../shared/ui/Segmented.tsx';
import { KIND_LABELS, SECRET_LABELS, vaultDraftProblem, type VaultDraft } from './vault.ts';

/** A masked field with a button that shows what was typed. It never holds a saved secret: those stay on the host. */
function SecretField(props: { readonly label: string; readonly value: string; readonly placeholder: string; readonly onInput: (value: string) => void }) {
  const [shown, setShown] = useState(false);
  const field = {
    autocomplete: 'off',
    spellcheck: false,
    placeholder: props.placeholder,
    value: props.value,
    onInput: (event: { readonly currentTarget: HTMLInputElement }) => {
      props.onInput(event.currentTarget.value);
    },
  };
  return (
    <label class="field">
      <span>{props.label}</span>
      <span class="secret-field">
        {shown ? <input type="text" {...field} /> : <input type="password" {...field} />}
        <button
          type="button"
          class="icon-btn"
          aria-label={shown ? `Hide ${props.label.toLowerCase()}` : `Show ${props.label.toLowerCase()}`}
          aria-pressed={shown}
          onClick={() => {
            setShown(!shown);
          }}
        >
          <Icon name={shown ? 'lock' : 'eye'} />
        </button>
      </span>
    </label>
  );
}

function TextField(props: { readonly label: string; readonly value: string; readonly placeholder: string; readonly onInput: (value: string) => void }) {
  return (
    <label class="field">
      <span>{props.label}</span>
      <input
        type="text"
        autocomplete="off"
        spellcheck={false}
        placeholder={props.placeholder}
        value={props.value}
        onInput={(event) => {
          props.onInput(event.currentTarget.value);
        }}
      />
    </label>
  );
}

/** Adds an item (choosing its kind) or changes one (`editing`), whose secrets show blank and stay unless replaced. */
export function VaultForm(props: {
  readonly draft: VaultDraft;
  readonly editing: VaultItem | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onDraft: (draft: VaultDraft) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}) {
  const { draft, editing } = props;
  const set = (patch: Partial<VaultDraft>): void => {
    props.onDraft({ ...draft, ...patch });
  };
  const problem = vaultDraftProblem(draft, editing);
  const keep = editing === null ? '' : 'Saved · type to replace';
  const hasTotp = editing?.kind === 'login' && editing.hasTotp;
  return (
    <form
      class="pair-panel vault-form"
      aria-label={editing === null ? 'New vault item' : `Edit ${editing.label}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (problem === null && !props.busy) props.onSubmit();
      }}
    >
      <div class="pair-info">
        {editing === null && (
          <Segmented<VaultItemKind>
            label="Kind"
            value={draft.kind}
            onChange={(kind) => {
              set({ kind });
            }}
            options={[
              { value: 'login', label: KIND_LABELS.login },
              { value: 'api_key', label: KIND_LABELS.api_key },
              { value: 'header_secret', label: KIND_LABELS.header_secret },
            ]}
          />
        )}
        <div class="vault-form-grid">
          <TextField label="Name agents see" placeholder="Work GitHub" value={draft.label} onInput={(label) => { set({ label }); }} />
          <TextField label="Website (optional)" placeholder="github.com" value={draft.site} onInput={(site) => { set({ site }); }} />
          {draft.kind === 'login' && <TextField label="Username or email" placeholder="you@example.com" value={draft.username} onInput={(username) => { set({ username }); }} />}
          {draft.kind === 'header_secret' && <TextField label="Header name" placeholder="Authorization" value={draft.headerName} onInput={(headerName) => { set({ headerName }); }} />}
          <SecretField label={SECRET_LABELS[draft.kind]} placeholder={keep} value={draft.secret} onInput={(secret) => { set({ secret }); }} />
          {draft.kind === 'login' && !draft.removeTwoStepKey && (
            <SecretField
              label="Two-step setup key (optional)"
              placeholder={hasTotp ? 'Saved · type to replace' : 'The key shown under “can’t scan the code?”'}
              value={draft.twoStepKey}
              onInput={(twoStepKey) => { set({ twoStepKey }); }}
            />
          )}
        </div>
        {hasTotp && (
          <label class="invite-check">
            <input
              type="checkbox"
              checked={draft.removeTwoStepKey}
              onChange={(event) => {
                set({ removeTwoStepKey: event.currentTarget.checked, twoStepKey: '' });
              }}
            />
            <span>Remove the two-step key</span>
          </label>
        )}
        <p class="setting-description">
          {draft.kind === 'login' && 'With a setup key, Ori Bot makes the 6-digit sign-in code itself when a tool signs in. '}
          Agents see the name, site{draft.kind === 'login' ? ' and username' : ''} only, never the secret.
        </p>
        {props.error !== null && (
          <p class="pair-error" role="alert">
            {props.error}
          </p>
        )}
        <div class="pair-actions">
          <button type="submit" class="btn primary" disabled={problem !== null || props.busy} title={problem ?? undefined}>
            {props.busy ? 'Saving…' : editing === null ? 'Add to vault' : 'Save changes'}
          </button>
          <button type="button" class="btn secondary" onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
