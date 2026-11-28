import type { EngineRow, SetupAction } from '../../shared/engine-setup.ts';
import { redact, type AppInfo } from '../../shared/privacy.ts';
import { guideFor } from './provider-guides.ts';
import { providerStatus, type ProviderStatus } from './provider-status.ts';
import type { ProviderCard } from './providers-model.ts';
import { setupCommand } from './setup-command.ts';

const guide = (providerId: string, label: Extract<SetupAction, { kind: 'guide' }>['label']): SetupAction => {
  const link = guideFor(providerId).link;
  return link === null ? { kind: 'recheck' } : { kind: 'guide', label, url: link.url };
};

function actionOf(card: ProviderCard, status: ProviderStatus, info: AppInfo, oneClick: boolean): SetupAction {
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
      return guide(id, 'How to install');
    case 'outdated':
      return guide(id, 'How to update');
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

/**
 * The built-in engines for the first-run checklist (spec §7): each with its live status line and
 * exactly one action when it is not ready. `oneClick` is true where Terminal sign-in works (macOS).
 */
export function engineRows(cards: readonly ProviderCard[], info: AppInfo, oneClick: boolean): readonly EngineRow[] {
  return cards
    .filter(({ entry }) => entry.manifest.kind === 'provider' && entry.source === 'built-in')
    .map((card) => {
      const status = providerStatus(card.entry, card.info, card.busy === 'rechecking');
      return {
        id: card.entry.manifest.id,
        name: card.entry.manifest.name,
        tone: status.tone,
        status: redact(status.title, info),
        ready: status.runnable,
        busy: card.busy !== null,
        action: actionOf(card, status, info, oneClick),
      };
    });
}
