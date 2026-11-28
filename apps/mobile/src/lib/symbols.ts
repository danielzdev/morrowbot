/** The SF Symbols Ori Bot uses, so a typo fails typecheck instead of drawing nothing. */
export type MorrowSymbol =
  | 'bubble.left.and.text.bubble.right'
  | 'rectangle.stack'
  | 'puzzlepiece.extension'
  | 'gearshape'
  | 'square.and.pencil'
  | 'slider.horizontal.3'
  | 'magnifyingglass'
  | 'plus'
  | 'chevron.left'
  | 'arrow.up.left.and.arrow.down.right'
  | 'arrow.down.right.and.arrow.up.left';

export interface ActionPreset {
  readonly label: string;
  readonly symbol: MorrowSymbol;
}

/** Shared looks for the contextual floating actions, so every slice draws them alike. */
export const ACTION_PRESETS: Readonly<
  Record<'newThread' | 'agentSettings' | 'newChat' | 'search' | 'addHost', ActionPreset>
> = {
  newThread: { label: 'New Thread', symbol: 'square.and.pencil' },
  agentSettings: { label: 'Agent Settings', symbol: 'slider.horizontal.3' },
  newChat: { label: 'New', symbol: 'square.and.pencil' },
  search: { label: 'Search', symbol: 'magnifyingglass' },
  addHost: { label: 'Add Host', symbol: 'plus' },
};
