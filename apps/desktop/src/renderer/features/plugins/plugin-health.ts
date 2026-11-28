import type { PluginEntry, PluginList, PluginProblem, PluginStatus } from '@morrowbot/contracts';
import { crashDetail } from '../../shared/crash-words.ts';

export type HealthTone = 'ok' | 'muted' | 'warning' | 'error';

/** A plugin's health pill (spec §6.3) and the detail "Show details" reveals. Detail text is redacted where it is shown. */
export interface Health {
  readonly tone: HealthTone;
  readonly label: string;
  readonly detail: string | null;
}

const pill = (tone: HealthTone, label: string, detail: string | null = null): Health => ({ tone, label, detail });

/** One pill per `PluginStatus` kind. */
export function healthOf(status: PluginStatus): Health {
  switch (status.kind) {
    case 'running':
      return pill('ok', 'Running');
    case 'starting':
      return pill('muted', 'Starting');
    case 'stopped':
      return pill('muted', 'Stopped');
    case 'disabled':
      return pill('muted', 'Turned off');
    case 'safe-mode':
      return pill('muted', 'Off in safe mode');
    case 'unhealthy':
      return pill('warning', 'Not responding', status.detail);
    case 'crashed':
      return pill('error', 'Crashed', crashDetail(status.reason));
    case 'quarantined':
      return pill('error', 'Quarantined', status.detail);
    case 'unsupported':
      return pill('muted', 'Unsupported', status.reason);
    case 'invalid-config':
      return pill('error', 'Settings invalid', status.problems.join('; '));
  }
}

/** A folder discovery could not load, as a row of its own. */
export function problemHealth(problem: PluginProblem): Health & { readonly title: string } {
  switch (problem.kind) {
    case 'invalid-manifest':
      return { ...pill('error', 'Invalid manifest', problem.problem), title: problem.folder };
    case 'duplicate':
      return {
        ...pill('warning', 'Duplicate', `Another ${problem.takenBy === 'built-in' ? 'built-in plugin' : 'plugin folder'} already uses the id “${problem.id}”, so this one was skipped.`),
        title: problem.folder,
      };
    case 'unreadable':
      return { ...pill('error', "Couldn't read folder", problem.problem), title: "Ori Bot couldn't read its plugin folders." };
  }
}

/**
 * Whether Extensions › Plugins lists this entry: every plugin except the providers built into
 * Ori Bot, which live in Settings › Providers. Community providers show in both.
 */
export function isListedPlugin(entry: PluginEntry): boolean {
  return !(entry.source === 'built-in' && entry.manifest.kind === 'provider');
}

const ALERTS: Partial<Readonly<Record<PluginStatus['kind'], { readonly tone: 'warn' | 'danger'; readonly words: string }>>> = {
  crashed: { tone: 'danger', words: 'crashed' },
  quarantined: { tone: 'danger', words: 'quarantined' },
  unhealthy: { tone: 'warn', words: 'not responding' },
  'invalid-config': { tone: 'warn', words: 'with settings to fix' },
};

const PROBLEM_ALERTS: Partial<Readonly<Record<PluginProblem['kind'], { readonly tone: 'warn'; readonly words: string }>>> = {
  'invalid-manifest': { tone: 'warn', words: 'with an invalid manifest' },
  unreadable: { tone: 'warn', words: "folder can't be read" },
};

export const SAFE_MODE_LINE = 'Safe mode: extensions are off.';

/** A finished phrase another part of Extensions adds to the row's words, such as "2 connectors need attention". */
export interface ExtensionsNote {
  readonly tone: 'warn' | 'danger';
  readonly text: string;
}

/** The Extensions row's dot and its spoken words (spec IA §2), or null when every plugin is fine and `others` has no note. */
export function extensionsAlert(
  list: Pick<PluginList, 'plugins' | 'safeMode' | 'problems'>,
  others: readonly (ExtensionsNote | null)[] = [],
): { readonly tone: 'warn' | 'danger'; readonly label: string } | null {
  if (list.safeMode) return { tone: 'warn', label: 'Extensions: off in safe mode' };
  const alerts = [
    ...list.plugins.filter(isListedPlugin).flatMap((entry) => ALERTS[entry.status.kind] ?? []),
    ...list.problems.flatMap((problem) => PROBLEM_ALERTS[problem.kind] ?? []),
  ];
  const notes = others.filter((note) => note !== null);
  const counts = new Map<string, number>();
  for (const alert of alerts) counts.set(alert.words, (counts.get(alert.words) ?? 0) + 1);
  const parts = [...[...counts].map(([words, count]) => `${String(count)} ${words}`), ...notes.map(({ text }) => text)];
  if (parts.length === 0) return null;
  const tone = [...alerts, ...notes].some((alert) => alert.tone === 'danger') ? 'danger' : 'warn';
  return { tone, label: `Extensions: ${parts.join(', ')}` };
}
