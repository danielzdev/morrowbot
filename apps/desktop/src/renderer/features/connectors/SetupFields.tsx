import type { ComposioAccount } from '@morrowbot/contracts';
import { useRef } from 'preact/hooks';
import { Icon } from '../../shared/ui/Icon.tsx';
import { Segmented } from '../../shared/ui/Segmented.tsx';
import type { ComposioDraft, SecretRow, SetupDraft } from './setup-draft.ts';

/** Numbers the rows added here, so each keeps its own key. */
let addedRows = 0;

/** Name and value rows for variables or headers. Values are typed as passwords; saved ones read "kept" until retyped. */
function SecretRows(props: { readonly title: string; readonly noun: string; readonly rows: readonly SecretRow[]; readonly onChange: (rows: readonly SecretRow[]) => void }) {
  const added = useRef<string | null>(null);
  const patch = (key: string, change: Partial<SecretRow>): void => {
    props.onChange(props.rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  };
  return (
    <fieldset class="secret-rows">
      <legend>{props.title}</legend>
      {props.rows.map((row, index) => {
        const named = row.name === '' ? `${props.noun} ${String(index + 1)}` : row.name;
        return (
          <div key={row.key} class="secret-row">
            <input
              ref={(element) => {
                if (element !== null && added.current === row.key) {
                  added.current = null;
                  element.focus();
                }
              }}
              type="text"
              class="mono"
              aria-label={`Name of ${props.noun} ${String(index + 1)}`}
              placeholder="Name"
              spellcheck={false}
              autocomplete="off"
              readOnly={row.saved}
              value={row.name}
              onInput={(event) => { patch(row.key, { name: event.currentTarget.value }); }}
            />
            <input
              type="password"
              aria-label={row.saved ? `Value of ${named}, kept unless you type a new one` : `Value of ${named}`}
              placeholder={row.saved ? 'Kept' : 'Value'}
              autocomplete="off"
              value={row.value}
              onInput={(event) => { patch(row.key, { value: event.currentTarget.value }); }}
            />
            <span class="secret-state">{row.saved && row.value === '' && <span class="tag">kept</span>}</span>
            <button type="button" class="icon-btn" aria-label={`Remove ${named}`} title="Remove" onClick={() => { props.onChange(props.rows.filter(({ key }) => key !== row.key)); }}>
              <Icon name="trash" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        class="btn ghost add-row"
        onClick={() => {
          addedRows += 1;
          const key = `new:${String(addedRows)}`;
          added.current = key;
          props.onChange([...props.rows, { key, name: '', value: '', saved: false }]);
        }}
      >
        <Icon name="plus" />
        Add {props.noun}
      </button>
    </fieldset>
  );
}

const ACCOUNTS: readonly { readonly value: ComposioAccount['kind']; readonly label: string }[] = [
  { value: 'user', label: 'User ID' },
  { value: 'connected-account', label: 'Connected account ID' },
];

function ComposioFields(props: { readonly draft: ComposioDraft; readonly onChange: (draft: ComposioDraft) => void }) {
  const { draft } = props;
  const patch = (change: Partial<ComposioDraft>): void => {
    props.onChange({ ...draft, ...change });
  };
  return (
    <>
      <label class="field">
        <span>Toolkit slug</span>
        <input type="text" class="mono" placeholder="gmail" spellcheck={false} autocomplete="off" value={draft.toolkit} onInput={(event) => { patch({ toolkit: event.currentTarget.value }); }} />
      </label>
      <label class="field">
        <span>Server URL</span>
        <input type="text" class="mono" placeholder="https://backend.composio.dev/v3/mcp/…" spellcheck={false} autocomplete="off" value={draft.serverUrl} onInput={(event) => { patch({ serverUrl: event.currentTarget.value }); }} />
      </label>
      <label class="field">
        <span>API key</span>
        <input type="password" placeholder={draft.keySaved ? 'Kept' : ''} autocomplete="off" value={draft.apiKey} onInput={(event) => { patch({ apiKey: event.currentTarget.value }); }} />
        {draft.keySaved && draft.apiKey === '' && <small class="binding-note">The saved key is kept unless you type a new one.</small>}
      </label>
      <div class="field">
        <span>Account</span>
        <Segmented label="Account by" value={draft.accountKind} options={ACCOUNTS} onChange={(accountKind) => { patch({ accountKind }); }} />
        <input
          type="text"
          class="mono"
          aria-label={draft.accountKind === 'user' ? 'User ID' : 'Connected account ID'}
          spellcheck={false}
          autocomplete="off"
          value={draft.accountId}
          onInput={(event) => { patch({ accountId: event.currentTarget.value }); }}
        />
      </div>
    </>
  );
}

/** The structured form for what a connector reaches: a local command, a remote MCP URL or a Composio account. */
export function SetupFields(props: { readonly draft: SetupDraft; readonly onChange: (draft: SetupDraft) => void }) {
  const { draft } = props;
  switch (draft.kind) {
    case 'stdio':
      return (
        <>
          <label class="field">
            <span>Command</span>
            <input type="text" class="mono" placeholder="npx" spellcheck={false} autocomplete="off" value={draft.command} onInput={(event) => { props.onChange({ ...draft, command: event.currentTarget.value }); }} />
          </label>
          <label class="field">
            <span>Arguments, one per line</span>
            <textarea class="mono" rows={3} spellcheck={false} value={draft.args} onInput={(event) => { props.onChange({ ...draft, args: event.currentTarget.value }); }} />
          </label>
          <SecretRows title="Environment variables" noun="variable" rows={draft.env} onChange={(env) => { props.onChange({ ...draft, env }); }} />
        </>
      );
    case 'http':
      return (
        <>
          <label class="field">
            <span>URL</span>
            <input type="text" class="mono" placeholder="https://example.com/mcp" spellcheck={false} autocomplete="off" value={draft.url} onInput={(event) => { props.onChange({ ...draft, url: event.currentTarget.value }); }} />
          </label>
          <SecretRows title="Headers" noun="header" rows={draft.headers} onChange={(headers) => { props.onChange({ ...draft, headers }); }} />
        </>
      );
    case 'composio':
      return <ComposioFields draft={draft} onChange={props.onChange} />;
  }
}
