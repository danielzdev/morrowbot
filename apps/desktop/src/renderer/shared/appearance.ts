import { z } from 'zod';
import { readPref, writePref } from './local-pref.ts';
import { Store } from './store.ts';

export const Theme = z.enum(['system', 'light', 'dark']);
export type Theme = z.infer<typeof Theme>;
export const ReduceMotion = z.enum(['system', 'on']);
export type ReduceMotion = z.infer<typeof ReduceMotion>;
/** The chat's reading column: Normal is 720px, Wide is 920px (spec §1.3). */
export const ChatWidth = z.enum(['normal', 'wide']);
export type ChatWidth = z.infer<typeof ChatWidth>;

/** The saved choices; a value saved before Chat width existed reads as Normal. */
export const AppearanceChoices = z.strictObject({ theme: Theme, reduceMotion: ReduceMotion, chatWidth: ChatWidth.default('normal') });
type Choices = z.infer<typeof AppearanceChoices>;
const KEY = 'morrowbot.appearance';

export interface Appearance extends Choices {
  /** The setting is On, or the OS asks for reduced motion (spec §1.6): no translate or scale, still avatars. */
  readonly reducedMotion: boolean;
}

export interface AppearanceModel {
  readonly state: Store<Appearance>;
  readonly set: (patch: Partial<Choices>) => void;
  readonly close: () => void;
}

/** Owns the appearance settings and puts them on `<html>` as `data-theme`, `data-motion` and `data-width`. */
export function createAppearance(root: HTMLElement): AppearanceModel {
  const saved = readPref<Choices>(KEY, AppearanceChoices, { theme: 'system', reduceMotion: 'system', chatWidth: 'normal' });
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const resolve = (choices: Choices): Appearance => ({ ...choices, reducedMotion: choices.reduceMotion === 'on' || media.matches });
  const state = new Store<Appearance>(resolve(saved));
  const apply = (value: Appearance): void => {
    root.dataset.theme = value.theme;
    root.dataset.motion = value.reducedMotion ? 'reduced' : 'full';
    root.dataset.width = value.chatWidth;
    writePref(KEY, { theme: value.theme, reduceMotion: value.reduceMotion, chatWidth: value.chatWidth });
  };
  apply(state.get());
  const stop = state.subscribe(apply);
  const onMedia = (): void => {
    state.set(resolve(state.get()));
  };
  media.addEventListener('change', onMedia);
  return {
    state,
    set: (patch) => {
      const { theme, reduceMotion, chatWidth } = state.get();
      state.set(resolve({ theme, reduceMotion, chatWidth, ...patch }));
    },
    close: () => {
      stop();
      media.removeEventListener('change', onMedia);
    },
  };
}
