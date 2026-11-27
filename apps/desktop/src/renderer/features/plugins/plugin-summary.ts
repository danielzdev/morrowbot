import type { PluginEntry, PluginStatus, ProviderInfo } from '@morrowbot/contracts';
import type { Loadable } from '../../shared/store.ts';

export type SummaryTone = 'ok' | 'muted' | 'warning' | 'error';

/** One line of what a plugin needs from the user, for its card on the Plugins page. */
export interface PluginSummary {
  readonly state:
    | PluginStatus['kind']
    | Exclude<ProviderInfo['kind'], 'ready-models-later'>
    | 'checking';
  readonly tone: SummaryTone;
  readonly title: string;
  readonly detail: string | null;
  /** A command to run in a terminal (sign-in), shown with Copy and Recheck. */
  readonly command: string | null;
}

/** Quotes argv for a POSIX shell, leaving plain words as they are. */
export function shellCommand(argv: readonly string[]): string {
  return argv.map((arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`)).join(' ');
}

function summary(state: PluginSummary['state'], tone: SummaryTone, title: string, detail: string | null = null): PluginSummary {
  return { state, tone, title, detail, command: null };
}

function fromStatus(status: PluginStatus): PluginSummary | undefined {
  switch (status.kind) {
    case 'running':
      return undefined;
    case 'quarantined':
      return summary('quarantined', 'error', 'Quarantined: cleanup could not be confirmed', status.detail);
    case 'unsupported':
      return summary('unsupported', 'muted', 'Not supported on this computer', status.reason);
    case 'disabled':
      return summary('disabled', 'muted', 'Turned off');
    case 'safe-mode':
      return summary('safe-mode', 'muted', 'Off in safe mode');
    case 'invalid-config':
      return summary('invalid-config', 'error', 'Settings need fixing', status.problems.join('; '));
    case 'starting':
      return summary('starting', 'muted', 'Starting…');
    case 'unhealthy':
      return summary('unhealthy', 'warning', 'Not responding', status.detail);
    case 'crashed':
      return summary('crashed', 'error', 'Stopped unexpectedly', crashDetail(status.reason));
    case 'stopped':
      return summary('stopped', 'muted', 'Stopped');
  }
}

function crashDetail(reason: Extract<PluginStatus, { kind: 'crashed' }>['reason']): string {
  switch (reason.kind) {
    case 'exit':
      return `Exited (${reason.signal ?? String(reason.code)})`;
    case 'timeout':
      return `Did not answer ${reason.request} in time`;
    case 'protocol':
      return reason.problem;
    case 'init-error':
    case 'spawn-error':
      return reason.message;
  }
}

function fromInfo(info: ProviderInfo): PluginSummary {
  switch (info.kind) {
    case 'missing-runtime':
      return summary('missing-runtime', 'warning', 'CLI not found', info.install);
    case 'outdated':
      return summary('outdated', 'warning', `CLI ${info.found} is too old`, `Supported: ${info.supported}`);
    case 'signed-out':
      return {
        ...summary('signed-out', 'warning', 'Signed out', 'Run this in a terminal, then press Recheck.'),
        command: shellCommand(info.signIn.argv),
      };
    case 'ready':
    case 'ready-models-later': {
      const account = info.accountLabel === null ? '' : ` · ${info.accountLabel}`;
      const title = info.capabilities.profiles.length === 0 ? `Ready ${info.version}, but no access level is available` : `Ready · ${info.version}${account}`;
      return summary('ready', info.capabilities.profiles.length === 0 ? 'warning' : 'ok', title, info.warning);
    }
    case 'error':
      return summary('error', 'error', 'Could not check the provider', info.message);
  }
}

export function summarize(entry: PluginEntry, info: Loadable<ProviderInfo> | null): PluginSummary {
  const status = fromStatus(entry.status);
  if (status !== undefined) return status;
  if (info === null) return summary('running', 'ok', 'Running');
  switch (info.kind) {
    case 'loading':
      return summary('checking', 'muted', 'Checking…');
    case 'failed':
      return summary('error', 'error', 'Could not check the provider', info.message);
    case 'loaded':
      return fromInfo(info.value);
  }
}

const ALERTS: Partial<Readonly<Record<PluginStatus['kind'], { readonly tone: 'warn' | 'danger'; readonly words: string }>>> = {
  crashed: { tone: 'danger', words: 'crashed' },
  quarantined: { tone: 'danger', words: 'quarantined' },
  unhealthy: { tone: 'warn', words: 'not responding' },
  'invalid-config': { tone: 'warn', words: 'with settings to fix' },
};

/** The Plugins button's dot and its accessible label (spec §3.1), or null when every plugin is fine. */
export function pluginAlert(entries: readonly PluginEntry[]): { readonly tone: 'warn' | 'danger'; readonly label: string } | null {
  if (entries.some((entry) => entry.status.kind === 'safe-mode')) return { tone: 'warn', label: 'Plugins: Safe mode: plugins are off.' };
  const counts = new Map<string, number>();
  let tone: 'warn' | 'danger' | null = null;
  for (const entry of entries) {
    const alert = ALERTS[entry.status.kind];
    if (alert === undefined) continue;
    counts.set(alert.words, (counts.get(alert.words) ?? 0) + 1);
    if (tone !== 'danger') tone = alert.tone;
  }
  if (tone === null) return null;
  return { tone, label: `Plugins: ${[...counts].map(([words, count]) => `${String(count)} ${words}`).join(', ')}` };
}
