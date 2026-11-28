import { AvatarFinish, AvatarShape, CUSTOM_AVATAR_OUTLINES } from '@morrowbot/contracts';
import { getExample, type AvatarDefinition } from 'open-bot-avatar';

/** One avatar shape: today's ids stay valid forever; new shapes and packs are new entries. */
export interface AvatarEntry {
  readonly id: AvatarShape;
  readonly label: string;
  readonly version: number;
  /** The engine's outline; undefined draws the static fallback. */
  readonly definition: AvatarDefinition | undefined;
  readonly pack: 'core';
}

const LABELS: Readonly<Record<AvatarShape, string>> = {
  chat: 'Chat',
  controller: 'Controller',
  barbell: 'Barbell',
  mug: 'Mug',
  lightbulb: 'Lightbulb',
  sprout: 'Sprout',
  'watering-can': 'Watering can',
  star: 'Star',
  cloud: 'Cloud',
  bolt: 'Bolt',
  flame: 'Flame',
  heart: 'Heart',
  book: 'Book',
  ghost: 'Ghost',
  shield: 'Shield',
};

const definitionOf = (id: AvatarShape): AvatarDefinition | undefined => getExample(id) ?? CUSTOM_AVATAR_OUTLINES.find((shape) => shape.id === id);

/** The versioned avatar registry (spec §5.3): the engine's built-in examples, then MorrowBot's own shapes. */
export const AVATARS: readonly AvatarEntry[] = AvatarShape.options.map((id) => ({ id, label: LABELS[id], version: 1, definition: definitionOf(id), pack: 'core' }));

export const avatarEntry = (id: string): AvatarEntry | undefined => AVATARS.find((entry) => entry.id === id);

export const FINISHES: readonly AvatarFinish[] = AvatarFinish.options;

const FINISH_LABELS: Readonly<Record<AvatarFinish, string>> = { flat: 'Flat', fluffy: 'Fluffy', matte: 'Matte', metallic: 'Metallic' };

export const finishLabel = (finish: AvatarFinish): string => FINISH_LABELS[finish];

/** The named swatches; any other #rrggbb comes from the custom colour input. */
export const SWATCHES: readonly { readonly name: string; readonly color: string }[] = [
  { name: 'Ocean', color: '#2563eb' },
  { name: 'Sky', color: '#0ea5e9' },
  { name: 'Mint', color: '#10b981' },
  { name: 'Amber', color: '#f59e0b' },
  { name: 'Coral', color: '#ef4444' },
  { name: 'Copper', color: '#b55b29' },
  { name: 'Rose', color: '#ec4899' },
  { name: 'Slate', color: '#6b7280' },
];
