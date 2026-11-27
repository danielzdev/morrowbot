import { z } from 'zod';
import { readPref, writePref } from './local-pref.ts';
import { Store } from './store.ts';

export const Theme = z.enum(['system', 'light', 'dark']);
export type Theme = z.infer<typeof Theme>;
export const ReduceMotion = z.enum(['system', 'on']);
export type ReduceMotion = z.infer<typeof ReduceMotion>;

const Saved = z.strictObject({ theme: Theme, reduceMotion: ReduceMotion });
const KEY = 'morrowbot.appearance';

export interface Appearance {
  readonly theme: Theme;
  readonly reduceMotion: ReduceMotion;
  /** The setting is On, or the OS asks for reduced motion (spec §1.6): no translate or scale, still avatars. */
  readonly reducedMotion: boolean;
}

export interface AppearanceModel {
  readonly state: Store<Appearance>;
  readonly setTheme: (theme: Theme) => void;
  readonly setReduceMotion: (value: ReduceMotion) => void;
  readonly close: () => void;
}

/** Owns the theme and motion settings and puts them on `<html>` as `data-theme` and `data-motion`. */
export function createAppearance(root: HTMLElement): AppearanceModel {
  const saved = readPref<z.infer<typeof Saved>>(KEY, Saved, { theme: 'system', reduceMotion: 'system' });
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const resolve = (theme: Theme, reduceMotion: ReduceMotion): Appearance => ({ theme, reduceMotion, reducedMotion: reduceMotion === 'on' || media.matches });
  const state = new Store<Appearance>(resolve(saved.theme, saved.reduceMotion));
  const apply = (value: Appearance): void => {
    root.dataset.theme = value.theme;
    root.dataset.motion = value.reducedMotion ? 'reduced' : 'full';
    writePref(KEY, { theme: value.theme, reduceMotion: value.reduceMotion });
  };
  apply(state.get());
  const stop = state.subscribe(apply);
  const onMedia = (): void => {
    const { theme, reduceMotion } = state.get();
    state.set(resolve(theme, reduceMotion));
  };
  media.addEventListener('change', onMedia);
  return {
    state,
    setTheme: (theme) => {
      state.set(resolve(theme, state.get().reduceMotion));
    },
    setReduceMotion: (value) => {
      state.set(resolve(state.get().theme, value));
    },
    close: () => {
      stop();
      media.removeEventListener('change', onMedia);
    },
  };
}
