import { useState } from 'preact/hooks';

export interface JoinFields {
  readonly link: string;
  readonly url: string;
  readonly code: string;
}

/**
 * Join a server: paste the invite link someone sent, or type the server's address with an invite code or the
 * 6-digit pairing code from your own server's Settings › Devices. `onJoin` answers a problem to show, or null.
 */
export function JoinServerForm(props: { readonly onJoin: (fields: JoinFields) => Promise<string | null>; readonly onCancel?: () => void }) {
  const [fields, setFields] = useState<JoinFields>({ link: '', url: '', code: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ready = fields.link.trim() !== '' || (fields.url.trim() !== '' && fields.code.trim() !== '');
  const set = (patch: Partial<JoinFields>): void => {
    setFields((current) => ({ ...current, ...patch }));
    setProblem(null);
  };
  return (
    <form
      class="join-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || busy) return;
        setBusy(true);
        void props.onJoin(fields).then((answer) => {
          setBusy(false);
          setProblem(answer);
        });
      }}
    >
      <label class="field">
        <span>Invite link</span>
        <input
          type="text"
          inputMode="url"
          spellcheck={false}
          autocomplete="off"
          placeholder="morrowbot://join?url=…&code=…"
          value={fields.link}
          onInput={(event) => {
            set({ link: event.currentTarget.value });
          }}
        />
      </label>
      <div class="join-or" aria-hidden="true">
        or
      </div>
      <div class="join-pair">
        <label class="field">
          <span>Server address</span>
          <input
            type="text"
            inputMode="url"
            spellcheck={false}
            autocomplete="off"
            placeholder="https://studio.example.ts.net"
            value={fields.url}
            disabled={fields.link.trim() !== ''}
            onInput={(event) => {
              set({ url: event.currentTarget.value });
            }}
          />
        </label>
        <label class="field">
          <span>Invite or pairing code</span>
          <input
            type="text"
            spellcheck={false}
            autocomplete="off"
            placeholder="042 137"
            value={fields.code}
            disabled={fields.link.trim() !== ''}
            onInput={(event) => {
              set({ code: event.currentTarget.value });
            }}
          />
        </label>
      </div>
      {problem !== null && (
        <p class="join-error" role="alert">
          {problem}
        </p>
      )}
      <div class="welcome-actions">
        <button type="submit" class="btn primary" disabled={!ready || busy}>
          {busy ? 'Joining…' : 'Join server'}
        </button>
        {props.onCancel !== undefined && (
          <button type="button" class="btn secondary" onClick={props.onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
