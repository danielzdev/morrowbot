import { CUSTOM_AVATAR_OUTLINES, type AvatarShape } from '@morrowbot/contracts';
import { getExample, type AvatarDefinition } from 'open-bot-avatar';

/** The engine's outline for a shape: one of its starter examples, or one of Ori Bot's own. */
export const definitionOf = (shape: AvatarShape): AvatarDefinition | undefined =>
  getExample(shape) ?? CUSTOM_AVATAR_OUTLINES.find(({ id }) => id === shape);
