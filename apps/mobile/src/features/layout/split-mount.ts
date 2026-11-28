import type { WorkspaceLayout } from '../../lib/layout.ts';

/**
 * Whether a tab keeps its `Split.Host` mounted. A split first mounts while its tab is on screen,
 * because react-native-screens attaches the split's columns only when the host is in a window at
 * mount; it then stays mounted, off screen too, until the device folds.
 */
export function holdsSplit(layout: WorkspaceLayout['kind'], onScreen: boolean, held: boolean): boolean {
  switch (layout) {
    case 'stack':
      return false;
    case 'split':
      return held || onScreen;
  }
}
