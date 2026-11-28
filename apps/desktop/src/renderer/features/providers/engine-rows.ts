import type { ProviderInstallCapabilities } from '../../bridge.ts';
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

function installOrDownload(providerId: string, capabilities: ProviderInstallCapabilities): SetupAction {
  const capability = capabilities[providerId];
  if (capability === undefined) return { kind: 'none' };
  switch (capability.kind) {
    case 'auto':
      return { kind: 'install', downloadUrl: null };
    case 'download':
      return { kind: 'guide', label: 'Download', url: capability.url };
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
    case 'outdated':
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
      return installOrDownload(id, capabilities);
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
 * The built-in engines for the first-run checklist (spec §7): focused on install and sign-in, with
 * no "How to install" links and no Update buttons (updates live in Settings › Providers).
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
      const installing = card.busy === 'installing';
      const status = providerStatus(card.entry, card.info, card.busy === 'rechecking');
      const detail = card.installDetail ?? null;
      return {
        id: card.entry.manifest.id,
        name: card.entry.manifest.name,
        tone: installing ? 'muted' : toneOf(status),
        status: installing ? 'Installing…' : redact(status.title, info),
        ready: !installing && status.runnable,
        busy: card.busy !== null,
        installing,
        progress: installing && detail !== null ? redact(detail, info) : null,
        action: installing ? { kind: 'install', downloadUrl: null } : actionOf(card, status, info, oneClick, capabilities),
      };
    });
}
