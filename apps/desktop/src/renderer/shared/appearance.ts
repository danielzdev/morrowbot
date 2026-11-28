import { z } from 'zod';
import { BubbleColorGlobal, BubbleColorOverride, type ResolvedTheme } from './bubble-color.ts';
import { readPref, writePref } from './local-pref.ts';
import { Store } from './store.ts';

export const Theme = z.enum(['system', 'light', 'dark']);
export type Theme = z.infer<typeof Theme>;
export const ReduceMotion = z.enum(['system', 'on']);
export type ReduceMotion = z.infer<typeof ReduceMotion>;
/** The chat's reading column: Normal is 720px, Wide is 920px (spec §1.3). */
export const ChatWidth = z.enum(['normal', 'wide']);
export type ChatWidth = z.infer<typeof ChatWidth>;

const AgentMessageColors = z.record(z.string(), BubbleColorOverride);
export type AgentMessageColors = z.infer<typeof AgentMessageColors>;

/** The saved choices; older values without Chat width, Message color or Send color upgrade cleanly to defaults. */
export const AppearanceChoices = z.strictObject({
  theme: Theme,
  reduceMotion: ReduceMotion,
  chatWidth: ChatWidth.default('normal'),
  messageColor: BubbleColorGlobal.default({ kind: 'match-bot' }),
  agentMessageColors: AgentMessageColors.default({}),
  /** The Send button in the agent's color; off, plain white or black with the theme. */
  sendInAgentColor: z.boolean().default(true),
});
type Choices = z.infer<typeof AppearanceChoices>;
const KEY = 'morrowbot.appearance';

export interface Appearance extends Choices {
  /** The setting is On, or the OS asks for reduced motion (spec §1.6): no translate or scale, still avatars. */
  readonly reducedMotion: boolean;
  /** The active light/dark theme after resolving `system` against the OS color scheme. */
  readonly resolvedTheme: ResolvedTheme;
}

export interface AppearanceModel {
  readonly state: Store<Appearance>;
  readonly set: (patch: Partial<Choices>) => void;
  /** Sets or clears (null = use global) a per-agent outgoing message bubble override. */
  readonly setAgentMessageColor: (agentId: string, override: BubbleColorOverride | null) => void;
  readonly close: () => void;
}

const DEFAULT_CHOICES: Choices = {
  theme: 'dark',
  reduceMotion: 'system',
  chatWidth: 'normal',
  messageColor: { kind: 'match-bot' },
  agentMessageColors: {},
  sendInAgentColor: true,
};

/** Owns the appearance settings and puts them on `<html>` as `data-theme`, `data-motion` and `data-width`. */
export function createAppearance(root: HTMLElement): AppearanceModel {
  const saved = readPref<Choices>(KEY, AppearanceChoices, DEFAULT_CHOICES);
  const motionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
  const darkMedia = window.matchMedia('(prefers-color-scheme: dark)');
  const resolve = (choices: Choices): Appearance => ({
    ...choices,
    reducedMotion: choices.reduceMotion === 'on' || motionMedia.matches,
    resolvedTheme: choices.theme === 'system' ? (darkMedia.matches ? 'dark' : 'light') : choices.theme,
  });
  const state = new Store<Appearance>(resolve(saved));
  const choicesOf = (value: Appearance): Choices => ({
    theme: value.theme,
    reduceMotion: value.reduceMotion,
    chatWidth: value.chatWidth,
    messageColor: value.messageColor,
    agentMessageColors: value.agentMessageColors,
    sendInAgentColor: value.sendInAgentColor,
  });
  const apply = (value: Appearance): void => {
    root.dataset.theme = value.theme;
    root.dataset.motion = value.reducedMotion ? 'reduced' : 'full';
    root.dataset.width = value.chatWidth;
    writePref(KEY, choicesOf(value));
  };
  apply(state.get());
  const stop = state.subscribe(apply);
  const onMedia = (): void => {
    state.set(resolve(choicesOf(state.get())));
  };
  motionMedia.addEventListener('change', onMedia);
  darkMedia.addEventListener('change', onMedia);
  return {
    state,
    set: (patch) => {
      state.set(resolve({ ...choicesOf(state.get()), ...patch }));
    },
    setAgentMessageColor: (agentId, override) => {
      const current = choicesOf(state.get());
      const others = Object.fromEntries(Object.entries(current.agentMessageColors).filter(([id]) => id !== agentId));
      const agentMessageColors = override === null ? others : { ...others, [agentId]: override };
      state.set(resolve({ ...current, agentMessageColors }));
    },
    close: () => {
      stop();
      motionMedia.removeEventListener('change', onMedia);
      darkMedia.removeEventListener('change', onMedia);
    },
  };
}
