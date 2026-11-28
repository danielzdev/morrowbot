import type { PluginConfig } from '@morrowbot/contracts';
import type { ProviderInstallCapability, ProviderInstallMode, ProviderInstallResult } from '../../bridge.ts';
import { BlockedBanner } from '../../shared/BlockedBanner.tsx';
import type { AppInfo } from '../../shared/privacy.ts';
import { DetailSection, Pill } from '../../shared/ui/ListDetail.tsx';
import { SettingsForm } from '../../shared/ui/SettingsForm.tsx';
import { Toggle } from '../../shared/ui/Toggle.tsx';
import { ProviderFacts } from './ProviderFacts.tsx';
import { ProviderMark } from './ProviderRow.tsx';
import { ProviderSetup } from './ProviderSetup.tsx';
import { providerStatus, versionOf } from './provider-status.ts';
import type { ProviderCard, StatusAge } from './providers-model.ts';

const clock = (iso: string): string => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** "Status loaded 10:42" after a plain fetch; "Checked 10:42" only after a Recheck (spec §6.2). */
function ageLine(age: StatusAge | null): string | null {
  if (age === null) return null;
  return age.via === 'recheck' ? `Checked ${clock(age.at)}` : `Status loaded ${clock(age.at)}`;
}

export interface ProviderActions {
  readonly onEnabled: (enabled: boolean) => void;
  readonly onRecheck: () => void;
  readonly onSaveConfig: (config: PluginConfig) => void;
  readonly onRelease: (regId: string) => void;
  readonly onCopy: (text: string) => Promise<void>;
  readonly onOpenLink: (url: string) => Promise<string | null>;
  /** Opens Terminal with the provider's own sign-in command and returns why it could not; null where one-click sign-in isn't offered. */
  readonly onSignInTerminal: (() => Promise<string | null>) | null;
  readonly installCapability?: ProviderInstallCapability | null;
  readonly onInstall?: ((mode: ProviderInstallMode) => Promise<ProviderInstallResult>) | null;
  readonly onCancelInstall?: (() => Promise<void>) | null;
  readonly onDirty: (dirty: boolean) => void;
}

/** One provider's detail: status and Recheck, setup, models, access, usage and settings (spec §6.2). */
export function ProviderDetail(props: { readonly card: ProviderCard; readonly info: AppInfo; readonly redact: (text: string) => string; readonly actions: ProviderActions }) {
  const { card, redact, actions } = props;
  const { entry } = card;
  const { manifest } = entry;
  const installing: ProviderInstallMode | null = card.busy === 'installing' ? 'install' : card.busy === 'updating' ? 'update' : null;
  const status = providerStatus(entry, card.info, card.busy === 'rechecking', installing);
  const activeSetup = status.setup ?? (installing !== null ? providerStatus(entry, card.info, false).setup : null);
  const version = versionOf(card.info);
  const age = ageLine(card.age);
  return (
    <article class="detail" aria-label={manifest.name}>
      <header class="detail-header">
        <ProviderMark name={manifest.name} />
        <div class="detail-title">
          <h2>{manifest.name}</h2>
          <div class="muted">
            {entry.source === 'user' ? 'Community provider' : 'Built into Ori Kami'}
            {version !== null && <span class="mono"> · {redact(version)}</span>}
          </div>
        </div>
        <Toggle label={`${manifest.name} on`} checked={entry.enabled} disabled={card.busy !== null} onChange={actions.onEnabled} />
      </header>

      <section class="status-card" aria-label="Status">
        <div class="status-card-line">
          <Pill tone={status.tone}>{status.title}</Pill>
          {age !== null && <span class="muted">{age}</span>}
          <span class="spacer" />
          <button type="button" class="btn secondary" disabled={card.busy !== null} onClick={actions.onRecheck}>
            {card.busy === 'rechecking' ? 'Rechecking…' : 'Recheck'}
          </button>
        </div>
        {status.detail !== null && <p class="status-detail">{redact(status.detail)}</p>}
        {card.problem !== null && (
          <p class="status-problem" role="alert">
            {redact(card.problem)}
          </p>
        )}
        {status.runnable && <p class="muted">To switch accounts, sign in to the other account in a terminal, then press Recheck.</p>}
      </section>

      <BlockedBanner groups={entry.blockedGroups} busy={card.busy !== null} onRelease={actions.onRelease} />

      {activeSetup !== null && (
        <DetailSection title={activeSetup.kind === 'sign-in' ? 'Sign in' : activeSetup.kind === 'update' ? 'Update' : 'Install'}>
          <ProviderSetup
            providerId={manifest.id}
            isBuiltin={entry.source === 'built-in'}
            setup={activeSetup}
            info={props.info}
            redact={redact}
            onCopy={actions.onCopy}
            onOpenLink={actions.onOpenLink}
            onSignInTerminal={actions.onSignInTerminal}
            installCapability={actions.installCapability ?? null}
            installing={installing}
            installDetail={card.installDetail ?? null}
            onInstall={actions.onInstall ?? null}
            onCancelInstall={actions.onCancelInstall ?? null}
          />
        </DetailSection>
      )}

      {card.info.kind === 'loaded' && <ProviderFacts info={card.info.value} usage={card.usage} redact={redact} />}

      {Object.keys(manifest.settingsSchema).length > 0 && (
        <DetailSection title="Settings">
          <SettingsForm
            key={JSON.stringify(entry.config)}
            idPrefix={`provider-${manifest.id}`}
            schema={manifest.settingsSchema}
            saved={entry.config}
            busy={card.busy === 'saving'}
            onSave={actions.onSaveConfig}
            onDirty={actions.onDirty}
          />
        </DetailSection>
      )}
      {!entry.enabled && entry.source === 'built-in' && <p class="muted">A built-in provider can't be removed. Turned off, it stays listed here, and agents that use it can't send new messages.</p>}
    </article>
  );
}
