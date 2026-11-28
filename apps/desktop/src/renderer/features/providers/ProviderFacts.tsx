import type { ProviderInfo, TurnMode, UsageResponse, UsageUnavailableReason, VendorSettings } from '@morrowbot/contracts';
import { formatTime } from '../../shared/format.ts';
import { profileName, withheldReason } from '../../shared/binding-ui/access-copy.ts';
import { DetailSection } from '../../shared/ui/ListDetail.tsx';

type Ready = Extract<ProviderInfo, { kind: 'ready' | 'ready-models-later' }>;

const MODES: Readonly<Record<TurnMode, string>> = { interactive: 'chats', background: 'background work' };
const INSTRUCTIONS: Readonly<Record<VendorSettings, string>> = {
  isolated: "Instructions: only the agent's SOUL.md",
  personal: "Instructions: the agent's SOUL.md and your personal CLI setup",
};

/** Models and their options (effort and the like), as the provider reports them. */
function Models({ info }: { readonly info: Ready }) {
  if (info.kind === 'ready-models-later') return <p class="muted">Models appear after the first message.</p>;
  if (info.models.length === 0) return <p class="muted">This provider reports no models.</p>;
  return (
    <ul class="fact-list">
      {info.models.map((model) => (
        <li key={model.id}>
          <span>{model.label}</span>
          {model.isDefault && <span class="tag">Default</span>}
          {model.options.map((option) => (
            <span key={option.id} class="muted">
              {' · '}
              {option.label}: {option.choices.map((choice) => choice.label).join(', ')}
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}

/** ✓ offered access levels and ✕ withheld ones with their reason, and who owns the instructions (spec §6.2). */
function Access({ info, redact }: { readonly info: Ready; readonly redact: (text: string) => string }) {
  const { profiles, withheld } = info.capabilities;
  return (
    <ul class="fact-list">
      {profiles.map((profile) => (
        <li key={`${profile.access}/${profile.vendorSettings}`} class="ok">
          ✓ {profileName(profile)} · for {profile.modes.map((mode) => MODES[mode]).join(' and ')}
          {profile.readsOutsideCwd ? ' · can read files outside the workspace' : ''}
          <div class="muted">{INSTRUCTIONS[profile.vendorSettings]}</div>
        </li>
      ))}
      {withheld.map((profile) => (
        <li key={`withheld-${profile.access}/${profile.vendorSettings}`} class="withheld">
          ✕ {profileName(profile)}: {withheldReason(profile.reason, redact)}
        </li>
      ))}
      {profiles.length === 0 && withheld.length === 0 && <li class="muted">No access level is offered.</li>}
    </ul>
  );
}

const UNAVAILABLE: Readonly<Record<UsageUnavailableReason, string>> = {
  unsupported: "Quota unavailable: this provider doesn't report usage limits.",
  'api-key-route': "Plan limits aren't available for this route.",
  'signed-out': 'Sign in to see limits.',
  'not-yet-observed': 'No limits reported yet.',
  'probe-failed': "Couldn't check limits.",
};

/** Limit windows, or the honest reason there are none (spec §6.4). Never a bar for an unavailable result. */
function Usage({ usage }: { readonly usage: UsageResponse }) {
  const result = usage.usage;
  if (result.kind === 'unavailable') return <p class="muted">{UNAVAILABLE[result.reason]}</p>;
  if (result.windows.length === 0) return <p class="muted">{UNAVAILABLE['not-yet-observed']}</p>;
  return (
    <div class="usage-mini">
      {result.windows.map((window) => (
        <div key={window.id} class="usage-row">
          <span>{window.label}</span>
          <div class="meter" role="img" aria-label={`${window.label}: ${String(Math.round(100 - window.usedPercent))}% left`}>
            <div style={{ width: `${String(window.usedPercent)}%` }} />
          </div>
          <span class="muted">
            {Math.round(100 - window.usedPercent)}% left{window.resetsAt === null ? '' : ` · resets ${formatTime(window.resetsAt)}`}
          </span>
        </div>
      ))}
      {usage.stale && <p class="muted">As of {formatTime(result.observedAt)} · may be out of date</p>}
    </div>
  );
}

/** What a ready provider offers: models, access and usage. */
export function ProviderFacts(props: { readonly info: ProviderInfo; readonly usage: UsageResponse | null; readonly redact: (text: string) => string }) {
  const { info } = props;
  if (info.kind !== 'ready' && info.kind !== 'ready-models-later') return null;
  return (
    <>
      <DetailSection title="Models">
        <Models info={info} />
      </DetailSection>
      <DetailSection title="Access">
        <Access info={info} redact={props.redact} />
      </DetailSection>
      {props.usage !== null && (
        <DetailSection title="Usage">
          <Usage usage={props.usage} />
        </DetailSection>
      )}
    </>
  );
}
