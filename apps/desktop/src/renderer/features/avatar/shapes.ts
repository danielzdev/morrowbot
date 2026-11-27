import { AvatarFinish, AvatarShape } from '@morrowbot/contracts';
import { getExample, type AvatarDefinition } from 'open-bot-avatar';

export const SHAPES: readonly AvatarShape[] = AvatarShape.options;
export const FINISHES: readonly AvatarFinish[] = AvatarFinish.options;

const SHAPE_LABELS: Readonly<Record<AvatarShape, string>> = {
  chat: 'Chat',
  controller: 'Controller',
  barbell: 'Barbell',
  mug: 'Mug',
  lightbulb: 'Lightbulb',
  sprout: 'Sprout',
  'watering-can': 'Watering can',
};

const FINISH_LABELS: Readonly<Record<AvatarFinish, string>> = { flat: 'Flat', fluffy: 'Fluffy', matte: 'Matte', metallic: 'Metallic' };

export const shapeLabel = (shape: AvatarShape): string => SHAPE_LABELS[shape];
export const finishLabel = (finish: AvatarFinish): string => FINISH_LABELS[finish];

/** The engine's outline for a shape: each shape is one of the engine's built-in examples. */
export const definitionOf = (shape: AvatarShape): AvatarDefinition | undefined => getExample(shape);
