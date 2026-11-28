import type { ProviderInstallCapabilities, ProviderInstallMode } from '../../bridge.ts';
import type { EngineRow, EngineTone, SetupAction } from '../../shared/engine-setup.ts';
import { redact, type AppInfo } from '../../shared/privacy.ts';
import { guideFor } from './provider-guides.ts';
import { providerStatus, type ProviderStatus } from './provider-status.ts';
import type { ProviderCard } from './providers-model.ts';
import { setupCommand } from './setup-command.ts';

const guide = (providerId: string, label: Extract<SetupAction, { kind: 'guide' }>['label']): SetupAction => {
  const link = guideFor(providerId).link;
  return link === null ? { kind: 'recheck' } : { kind: 'guide', label, url: link.url };
};

function installOrGuide(
  providerId: string,
  mode: ProviderInstallMode,
  capabilities: ProviderInstallCapabilities,
): SetupAction {
  const capability = capabilities[providerId];
  const fallbackLabel = mode === 'update' ? 'How to update' : 'How to install';
  if (capability === undefined) return guide(providerId, fallbackLabel);
  switch (capability.kind) {
    case 'auto':
      return { kind: 'install', mode, guideUrl: guideFor(providerId).link?.url ?? null };
    case 'download':
      return {
        kind: 'guide',
        label: mode === 'update' ? 'How to update' : capability.label === 'Download' ? 'Download' : 'How to install',
        url: capability.url,
      };
  }
}

function actionOf(
  card: ProviderCard,
  status: ProviderStatus,
  info: AppInfo,
  oneClick: boolean,
  capabilities: ProviderInstallCapabilities,
): SetupAction {
  const id = card.entry.manifest.id;
  if (status.runnable) return { kind: 'none' };
  switch (status.state) {
    case 'checking':
    case 'rechecking':
    case 'starting':
    case 'unsupported':
    case 'safe-mode':
      return { kind: 'none' };
    case 'disabled':
      return { kind: 'turn-on' };
    case 'signed-out': {
      if (status.setup?.kind !== 'sign-in') return { kind: 'recheck' };
      if (oneClick && card.entry.source === 'built-in') return { kind: 'sign-in-terminal' };
      const command = setupCommand(status.setup.argv, info);
      return command.kind === 'copy' ? command : guide(id, 'How to set up');
    }
    case 'missing-runtime':
      return installOrGuide(id, 'install', capabilities);
    case 'outdated':
      return installOrGuide(id, 'update', capabilities);
    case 'ready':
    case 'error':
    case 'running':
    case 'stopped':
    case 'crashed':
    case 'unhealthy':
    case 'quarantined':
    case 'invalid-config':
      return { kind: 'recheck' };
  }
}

function toneOf(status: ProviderStatus): EngineTone {
  return status.state === 'missing-runtime' ? 'muted' : status.tone;
}

/**
 * The built-in engines for the first-run checklist (spec §7): each with its live status line and
 * one calm action when it is not ready. `oneClick` is true where Terminal sign-in works (macOS).
 */
export function engineRows(
  cards: readonly ProviderCard[],
  info: AppInfo,
  oneClick: boolean,
  capabilities: ProviderInstallCapabilities = {},
): readonly EngineRow[] {
  return cards
    .filter(({ entry }) => entry.manifest.kind === 'provider' && entry.source === 'built-in')
    .map((card) => {
      const installing: ProviderInstallMode | null = card.busy === 'installing' ? 'install' : card.busy === 'updating' ? 'update' : null;
      const status = providerStatus(card.entry, card.info, card.busy === 'rechecking');
      const detail = card.installDetail ?? null;
      return {
        id: card.entry.manifest.id,
        name: card.entry.manifest.name,
        tone: installing !== null ? 'muted' : toneOf(status),
        status: installing === 'update' ? 'Updating…' : installing === 'install' ? 'Installing…' : redact(status.title, info),
        ready: installing === null && status.runnable,
        busy: card.busy !== null,
        installing,
        progress: installing !== null && detail !== null ? redact(detail, info) : null,
        action: installing !== null ? { kind: 'install', mode: installing, guideUrl: guideFor(card.entry.manifest.id).link?.url ?? null } : actionOf(card, status, info, oneClick, capabilities),
      };
    });
}
