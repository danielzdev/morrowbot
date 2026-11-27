import type { AccessProfile } from '@morrowbot/contracts';
import { useRef, useState } from 'preact/hooks';
import { Icon, type IconName } from '../ui/Icon.tsx';
import { profileDescription, profileName, profileWarnings, withheldReason } from './access-copy.ts';
import { accessKey, sameAccess, type AccessKey, type AccessState } from './binding-state.ts';

const STEP: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

const iconOf = (profile: AccessKey): IconName => (profile.access === 'read-only' ? 'eye' : 'pencil');

/**
 * One segment per interactive profile the provider offers, built from the profile's fields (spec
 * §4.6). Withheld profiles are disabled segments whose reason is their `aria-description` and is also
 * listed below, so it can be read without hover. A saved profile that is not offered selects nothing.
 */
export function AccessSegment(props: {
  readonly state: AccessState | null;
  /** The access shown as chosen: the saved one, or the one staged in a form. */
  readonly value: AccessKey;
  readonly disabled: boolean;
  /** False in the popover, where each pick is saved: arrows only move, Space or Enter picks. */
  readonly arrowsSelect?: boolean;
  readonly redact: (text: string) => string;
  readonly onPick: (profile: AccessProfile) => void;
  readonly onOpenProviders: () => void;
}) {
  const group = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const { state } = props;
  if (state === null) return null;
  if (state.offered.length === 0) {
    const reason = state.withheld[0]?.reason;
    return (
      <div class="access-empty">
        <p class="binding-note">{reason === undefined ? 'No interactive access is available.' : withheldReason(reason, props.redact)}</p>
        <button type="button" class="btn secondary" onClick={props.onOpenProviders}>
          Open Providers
        </button>
      </div>
    );
  }
  const selected = state.offered.find((profile) => sameAccess(profile, props.value));
  const described = state.offered.find((profile) => accessKey(profile) === focused) ?? selected;
  const pick = (profile: AccessProfile): void => {
    if (!props.disabled && (selected === undefined || !sameAccess(profile, selected))) props.onPick(profile);
  };
  return (
    <div class="access-segment">
      <div
        ref={group}
        role="radiogroup"
        aria-label="Access"
        class="segmented access-row"
        onKeyDown={(event) => {
          const step = STEP[event.key];
          if (step === undefined) return;
          event.preventDefault();
          const at = state.offered.findIndex((profile) => accessKey(profile) === (focused ?? (selected === undefined ? '' : accessKey(selected))));
          const next = state.offered[(at + step + state.offered.length) % state.offered.length];
          if (next === undefined) return;
          if (props.arrowsSelect !== false) pick(next);
          group.current?.querySelector<HTMLElement>(`[data-access="${accessKey(next)}"]`)?.focus();
        }}
      >
        {state.offered.map((profile, index) => {
          const checked = selected !== undefined && sameAccess(profile, selected);
          return (
            <button
              key={accessKey(profile)}
              type="button"
              role="radio"
              aria-checked={checked}
              data-access={accessKey(profile)}
              tabIndex={checked || (selected === undefined && index === 0) ? 0 : -1}
              disabled={props.disabled}
              class={`segment ${profileWarnings(profile).length > 0 ? 'warns' : ''}`}
              onFocus={() => {
                setFocused(accessKey(profile));
              }}
              onBlur={() => {
                setFocused(null);
              }}
              onClick={() => {
                pick(profile);
              }}
            >
              <Icon name={iconOf(profile)} />
              {profileName(profile)}
              {profileWarnings(profile).length > 0 && <Icon name="warning" />}
            </button>
          );
        })}
        {state.withheld.map((profile) => (
          <button
            key={`withheld-${accessKey(profile)}`}
            type="button"
            role="radio"
            aria-checked={false}
            disabled
            aria-description={withheldReason(profile.reason, props.redact)}
            class="segment withheld"
          >
            <Icon name="lock-off" />
            {profileName(profile)}
          </button>
        ))}
      </div>
      {described === undefined ? (
        <p class="binding-note warn">
          {state.current.kind === 'withheld'
            ? `This agent's access isn't available: ${withheldReason(state.current.reason, props.redact)} Pick an offered one.`
            : "This agent's access is no longer offered. Pick an offered one."}
        </p>
      ) : (
        <>
          <p class="binding-note">{profileDescription(described, state.approvals)}</p>
          {profileWarnings(described).map((warning) => (
            <p key={warning} class="binding-note warn">
              <Icon name="warning" /> {warning}
            </p>
          ))}
        </>
      )}
      {state.withheld.length > 0 && (
        <div class="withheld-list">
          <div class="kicker">Unavailable</div>
          <ul>
            {state.withheld.map((profile) => (
              <li key={accessKey(profile)}>
                <strong>{profileName(profile)}</strong>: {withheldReason(profile.reason, props.redact)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
