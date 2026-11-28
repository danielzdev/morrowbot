import type { PluginEntry, PluginStatus } from '@morrowbot/contracts';

export type ExtensionsSegment = 'plugins' | 'connectors' | 'marketplace';

export const SEGMENTS: readonly { readonly key: ExtensionsSegment; readonly label: string }[] = [
  { key: 'plugins', label: 'Plugins' },
  { key: 'connectors', label: 'Connectors' },
  { key: 'marketplace', label: 'Marketplace' },
];

export type BadgeTone = 'ok' | 'muted' | 'warn' | 'danger';

export interface StatusBadge {
  readonly tone: BadgeTone;
  readonly label: string;
}

/** One badge per plugin status. */
export function badgeOf(status: PluginStatus): StatusBadge {
  switch (status.kind) {
    case 'running':
      return { tone: 'ok', label: 'Running' };
    case 'starting':
      return { tone: 'muted', label: 'Starting' };
    case 'stopped':
      return { tone: 'muted', label: 'Stopped' };
    case 'disabled':
      return { tone: 'muted', label: 'Off' };
    case 'safe-mode':
      return { tone: 'muted', label: 'Off in safe mode' };
    case 'unsupported':
      return { tone: 'muted', label: 'Unsupported' };
    case 'unhealthy':
      return { tone: 'warn', label: 'Not responding' };
    case 'invalid-config':
      return { tone: 'warn', label: 'Settings to fix' };
    case 'crashed':
      return { tone: 'danger', label: 'Crashed' };
    case 'quarantined':
      return { tone: 'danger', label: 'Quarantined' };
  }
}

/** Built-in providers live in Settings › Providers, so Plugins lists everything else. */
export function isListedPlugin(entry: PluginEntry): boolean {
  return !(entry.source === 'built-in' && entry.manifest.kind === 'provider');
}

const matches = (entry: PluginEntry, query: string): boolean => {
  const needle = query.trim().toLocaleLowerCase();
  return needle === '' || entry.manifest.name.toLocaleLowerCase().includes(needle) || entry.manifest.id.includes(needle);
};

/**
 * The rows one segment shows. Connectors arrive with the host's connector support, so that segment is
 * empty for now; Marketplace has no online catalog yet and lists what is installed.
 */
export function segmentRows(plugins: readonly PluginEntry[], segment: ExtensionsSegment, query: string): readonly PluginEntry[] {
  switch (segment) {
    case 'plugins':
    case 'marketplace':
      return plugins.filter((entry) => isListedPlugin(entry) && matches(entry, query));
    case 'connectors':
      return [];
  }
}
