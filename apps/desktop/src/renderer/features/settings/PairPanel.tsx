import type { PairingCodeResponse } from '@morrowbot/contracts';
import { useEffect, useRef } from 'preact/hooks';
import { Icon } from '../../shared/ui/Icon.tsx';
import { countdown, spacedCode } from './pairing.ts';
import { QrCode } from './QrCode.tsx';

const EXAMPLE_URL = 'http://100.64.0.1:47800';

/** A live pairing code: the QR of `pairingUri`, the code, its countdown and the address it carries. */
export function PairCode(props: { readonly code: PairingCodeResponse; readonly now: number; readonly onNewCode: () => void; readonly onDone: () => void }) {
  const { code } = props;
  const left = countdown(code.expiresAt, props.now);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
  }, []);
  return (
    <div class="pair-panel">
      <QrCode text={code.pairingUri} label={`QR code for pairing code ${spacedCode(code.code)}`} faded={left === null} />
      <div class="pair-info">
        <div class="kicker">Pairing code</div>
        <div class="pair-code mono">{spacedCode(code.code)}</div>
        <p class={left === null ? 'pair-expiry expired' : 'pair-expiry'}>{left === null ? 'This code expired.' : `Expires in ${left}`}</p>
        <div class="pair-address">
          <span class="kicker">Address</span>
          <span class="mono">{code.url}</span>
        </div>
        <p class="setting-description">
          In Ori Bot on your phone, open Settings › Connections › Add Host, then scan the QR code or enter the address and code. Each code works once, for 5 minutes.
        </p>
        <div class="pair-actions">
          {left === null ? (
            <button type="button" class="btn primary" onClick={props.onNewCode}>
              New code
            </button>
          ) : (
            <span class="setting-note">Waiting for your phone…</span>
          )}
          <button ref={close} type="button" class="btn secondary" onClick={props.onDone}>
            {left === null ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Shown when `ORIBOT_HOST_BIND` is unset: the host needs the address phones should use. */
export function PairNeedsUrl(props: {
  readonly url: string;
  readonly error: string | null;
  readonly busy: boolean;
  readonly onUrl: (url: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  return (
    <form
      class="pair-panel pair-needs-url"
      onSubmit={(event) => {
        event.preventDefault();
        if (props.url.trim() !== '') props.onSubmit();
      }}
    >
      <span class="pair-warning">
        <Icon name="warning" />
      </span>
      <div class="pair-info">
        <div class="setting-label">Which address should phones use?</div>
        <p class="setting-description">
          Ori Bot doesn't know where phones can reach it. Set <code>ORIBOT_HOST_BIND</code> to this computer's LAN or Tailscale address (such as{' '}
          <code>100.64.0.1</code>) and restart Ori Bot, or enter the address phones should use.
        </p>
        <label class="field">
          <span>Address</span>
          <input
            ref={input}
            type="text"
            inputMode="url"
            spellcheck={false}
            autocomplete="off"
            placeholder={EXAMPLE_URL}
            value={props.url}
            aria-invalid={props.error === null ? undefined : true}
            onInput={(event) => {
              props.onUrl(event.currentTarget.value);
            }}
          />
        </label>
        {props.error !== null && (
          <p class="pair-error" role="alert">
            {props.error}
          </p>
        )}
        <div class="pair-actions">
          <button type="submit" class="btn primary" disabled={props.busy || props.url.trim() === ''}>
            Show code
          </button>
          <button type="button" class="btn secondary" onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
