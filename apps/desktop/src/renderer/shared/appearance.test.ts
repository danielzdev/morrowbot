import { expect, it } from 'vitest';
import { AppearanceChoices } from './appearance.ts';

it('keeps a theme saved before Chat width existed, and refuses unknown values', () => {
  expect({
    older: AppearanceChoices.safeParse({ theme: 'dark', reduceMotion: 'on' }).data,
    current: AppearanceChoices.safeParse({ theme: 'light', reduceMotion: 'system', chatWidth: 'wide' }).data,
    unknown: AppearanceChoices.safeParse({ theme: 'light', reduceMotion: 'system', chatWidth: 'huge' }).success,
  }).toEqual({
    older: { theme: 'dark', reduceMotion: 'on', chatWidth: 'normal' },
    current: { theme: 'light', reduceMotion: 'system', chatWidth: 'wide' },
    unknown: false,
  });
});
