import type { PluginEntry, PluginStatus, ProviderInfo } from '@morrowbot/contracts';
import { crashDetail } from '../../shared/crash-words.ts';
import { planLabel } from '../../shared/privacy.ts';
import type { Loadable } from '../../shared/store.ts';

export type StatusTone = 'ok' | 'muted' | 'warning' | 'error';

/** What the provider needs from the user before it can chat: a terminal command, or install/update steps in words. */
export type ProviderSetup =
  | { readonly kind: 'sign-in'; readonly argv: readonly string[] }
  | { readonly kind: 'install'; readonly text: string }
  | { readonly kind: 'update'; readonly found: string; readonly supported: string };

/** A provider's one status line (spec §6.2), shown in its row, its detail and the composer chip. Text is redacted where it is shown. */
export interface ProviderStatus {
  readonly state: PluginStatus['kind'] | Exclude<ProviderInfo['kind'], 'ready-models-later'> | 'checking' | 'rechecking';
  readonly tone: StatusTone;
  readonly title: string;
  readonly detail: string | null;
  readonly setup: ProviderSetup | null;
  /** New chats can be sent: ready with an interactive access level. Warnings do not stop sends. */
  readonly runnable: boolean;
}

function line(state: ProviderStatus['state'], tone: StatusTone, title: string, detail: string | null = null): ProviderStatus {
  return { state, tone, title, detail, setup: null, runnable: false };
}

function fromStatus(status: PluginStatus): ProviderStatus | undefined {
  switch (status.kind) {
    case 'running':
      return undefined;
    case 'quarantined':
      return line('quarantined', 'error', 'Quarantined: cleanup could not be confirmed', status.detail);
    case 'unsupported':
      return line('unsupported', 'muted', 'Not supported on this computer', status.reason);
    case 'disabled':
      return line('disabled', 'muted', 'Turned off');
    case 'safe-mode':
      return line('safe-mode', 'muted', 'Off in safe mode');
    case 'invalid-config':
      return line('invalid-config', 'error', 'Settings need fixing', status.problems.join('; '));
    case 'starting':
      return line('starting', 'muted', 'Starting…');
    case 'unhealthy':
      return line('unhealthy', 'warning', 'Not responding', status.detail);
    case 'crashed':
      return line('crashed', 'error', 'Crashed', crashDetail(status.reason));
    case 'stopped':
      return line('stopped', 'muted', 'Stopped');
  }
}

function fromInfo(info: ProviderInfo): ProviderStatus {
  switch (info.kind) {
    case 'missing-runtime':
      return { ...line('missing-runtime', 'warning', 'Not installed', info.install), setup: { kind: 'install', text: info.install } };
    case 'outdated':
      return { ...line('outdated', 'warning', `Needs update · found ${info.found}, needs ${info.supported}`), setup: { kind: 'update', found: info.found, supported: info.supported } };
    case 'signed-out':
      return { ...line('signed-out', 'warning', 'Sign-in needed'), setup: { kind: 'sign-in', argv: info.signIn.argv } };
    case 'ready':
    case 'ready-models-later': {
      const { profiles, withheld } = info.capabilities;
      if (!profiles.some(({ modes }) => modes.includes('interactive'))) {
        const reason = withheld[0]?.reason;
        return reason === undefined ? line('ready', 'warning', 'No interactive access is available') : line('ready', 'warning', 'Chats paused', reason);
      }
      if (info.warning !== null) return { ...line('ready', 'warning', "Ready · Review this provider's status", info.warning), runnable: true };
      const plan = info.accountLabel === null ? null : planLabel(info.accountLabel);
      return { ...line('ready', 'ok', plan === null ? 'Ready' : `Ready · ${plan}`), runnable: true };
    }
    case 'error':
      return line('error', 'error', "Couldn't check provider", info.message);
  }
}

/** The status line for a provider's entry and info; `rechecking` while a Recheck runs. */
export function providerStatus(entry: PluginEntry, info: Loadable<ProviderInfo>, rechecking = false): ProviderStatus {
  const status = fromStatus(entry.status);
  if (status !== undefined) return status;
  if (rechecking) return line('rechecking', 'muted', 'Rechecking…');
  switch (info.kind) {
    case 'loading':
      return line('checking', 'muted', 'Checking…');
    case 'failed':
      return line('error', 'error', "Couldn't check provider", info.message);
    case 'loaded':
      return fromInfo(info.value);
  }
}

/** The CLI version the provider reports, for the mono tag in its row; null when it reports none. */
export function versionOf(info: Loadable<ProviderInfo>): string | null {
  if (info.kind !== 'loaded') return null;
  switch (info.value.kind) {
    case 'ready':
    case 'ready-models-later':
      return info.value.version;
    case 'outdated':
      return info.value.found;
    case 'missing-runtime':
    case 'signed-out':
    case 'error':
      return null;
  }
}
