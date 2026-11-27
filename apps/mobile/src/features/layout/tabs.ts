import type { MorrowSymbol } from '../../lib/symbols.ts';
import type { TabKey } from '../../lib/workspace.ts';

export interface TabItem {
  readonly key: TabKey;
  readonly title: string;
  readonly symbol: MorrowSymbol;
}

/** The rail, top to bottom; Settings sits last, at the bottom of the capsule. */
export const TAB_ITEMS: readonly TabItem[] = [
  { key: 'agents', title: 'Agents', symbol: 'bubble.left.and.text.bubble.right' },
  { key: 'threads', title: 'All Threads', symbol: 'rectangle.stack' },
  { key: 'extensions', title: 'Extensions', symbol: 'puzzlepiece.extension' },
  { key: 'settings', title: 'Settings', symbol: 'gearshape' },
];

export function tabKeyOf(screenKey: string): TabKey | null {
  return TAB_ITEMS.find((item) => item.key === screenKey)?.key ?? null;
}
