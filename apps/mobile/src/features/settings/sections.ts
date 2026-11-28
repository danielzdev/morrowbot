import type { SFSymbol } from 'expo-symbols';
import type { SettingsSection } from '../../lib/workspace.ts';

export interface SectionInfo {
  readonly section: SettingsSection;
  readonly label: string;
  readonly symbol: SFSymbol;
  /** Other words people search for to find this section. */
  readonly keywords: readonly string[];
}

export const SECTIONS: readonly SectionInfo[] = [
  {
    section: 'connections',
    label: 'Connections',
    symbol: 'desktopcomputer',
    keywords: ['hosts', 'tailscale', 'lan', 'pair', 'pairing', 'qr', 'code', 'unpair', 'disconnect', 'forget'],
  },
  { section: 'notifications', label: 'Notifications', symbol: 'bell.badge', keywords: ['alerts', 'push', 'needs you', 'badges'] },
  {
    section: 'appearance',
    label: 'Appearance',
    symbol: 'circle.lefthalf.filled',
    keywords: ['dark', 'light', 'system', 'theme', 'dusk', 'violet', 'accent', 'colour', 'color'],
  },
  { section: 'providers', label: 'Providers & Models', symbol: 'cpu', keywords: ['claude', 'codex', 'model', 'provider', 'sign in'] },
  { section: 'usage', label: 'Usage', symbol: 'chart.bar', keywords: ['tokens', 'limits', 'turns'] },
];

export function sectionInfo(section: SettingsSection): SectionInfo {
  const found = SECTIONS.find((info) => info.section === section);
  if (found === undefined) throw new Error(`Unknown settings section ${section}`);
  return found;
}

/** Sections whose name or keywords start a word with every typed word, in list order. */
export function searchSections(query: string): readonly SectionInfo[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return SECTIONS;
  return SECTIONS.filter((info) => {
    const haystack = [info.label, ...info.keywords].join(' ').toLowerCase().split(/[\s&]+/);
    return words.every((word) => haystack.some((candidate) => candidate.startsWith(word)));
  });
}
