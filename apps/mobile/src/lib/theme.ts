/**
 * MorrowBot mobile theme. Colours match the desktop tokens
 * (`apps/desktop/src/renderer/styles/tokens.css`): Graphite greys, with blue only for signals.
 */

export type ColorSchemeName = 'light' | 'dark';

export interface ThemeColors {
  readonly surface0: string;
  readonly surface1: string;
  readonly surface2: string;
  readonly surface3: string;
  readonly surfaceUser: string;
  readonly hover: string;
  readonly selected: string;
  readonly hairline: string;
  readonly hairlineStrong: string;
  readonly controlEdge: string;
  readonly text1: string;
  readonly text2: string;
  readonly text3: string;
  readonly textDisabled: string;
  readonly accent: string;
  readonly accentPressed: string;
  readonly onAccent: string;
  readonly accentSoft: string;
  readonly ok: string;
  readonly warn: string;
  readonly danger: string;
  readonly info: string;
  readonly scrim: string;
}

export interface GlassTokens {
  /** Tint passed to the native Liquid Glass view. */
  readonly tint: string;
  /** Solid-ish fill used where Liquid Glass is unavailable. */
  readonly fallbackFill: string;
  readonly fallbackEdge: string;
}

export interface Theme {
  readonly scheme: ColorSchemeName;
  readonly colors: ThemeColors;
  readonly glass: GlassTokens;
}

const dark: ThemeColors = {
  surface0: '#1A1A1A',
  surface1: '#1A1A1A',
  surface2: '#212121',
  surface3: '#242424',
  surfaceUser: '#2A2A2A',
  hover: 'rgba(255, 255, 255, 0.035)',
  selected: 'rgba(255, 255, 255, 0.055)',
  hairline: 'rgba(255, 255, 255, 0.04)',
  hairlineStrong: 'rgba(255, 255, 255, 0.10)',
  controlEdge: '#808080',
  text1: '#FFFFFF',
  text2: '#ADADAD',
  text3: '#9E9E9E',
  textDisabled: '#5E5E5E',
  accent: '#74B9FF',
  accentPressed: '#93C8FF',
  onAccent: '#0D0D0D',
  accentSoft: 'rgba(116, 185, 255, 0.1)',
  ok: '#4ADE80',
  warn: '#F5C451',
  danger: '#F87C7C',
  info: '#7AB8FF',
  scrim: 'rgba(0, 0, 0, 0.6)',
};

const light: ThemeColors = {
  surface0: '#FAFAFA',
  surface1: '#FAFAFA',
  surface2: '#F2F2F2',
  surface3: '#FFFFFF',
  surfaceUser: '#EAEAEA',
  hover: 'rgba(0, 0, 0, 0.04)',
  selected: 'rgba(0, 0, 0, 0.06)',
  hairline: 'rgba(0, 0, 0, 0.08)',
  hairlineStrong: 'rgba(0, 0, 0, 0.14)',
  controlEdge: '#757575',
  text1: '#0D0D0D',
  text2: '#4F4F4F',
  text3: '#5E5E5E',
  textDisabled: '#B0B0B0',
  accent: '#0B5FC5',
  accentPressed: '#094EA3',
  onAccent: '#FFFFFF',
  accentSoft: 'rgba(11, 95, 197, 0.1)',
  ok: '#116D33',
  warn: '#805300',
  danger: '#B91C1C',
  info: '#1958C2',
  scrim: 'rgba(0, 0, 0, 0.25)',
};

const THEMES: Readonly<Record<ColorSchemeName, Theme>> = {
  dark: {
    scheme: 'dark',
    colors: dark,
    glass: {
      tint: 'rgba(26, 26, 26, 0.35)',
      fallbackFill: 'rgba(33, 33, 33, 0.92)',
      fallbackEdge: dark.hairlineStrong,
    },
  },
  light: {
    scheme: 'light',
    colors: light,
    glass: {
      tint: 'rgba(255, 255, 255, 0.35)',
      fallbackFill: 'rgba(250, 250, 250, 0.94)',
      fallbackEdge: light.hairlineStrong,
    },
  },
};

/**
 * The theme for the system appearance. React Native reports `null` or `'unspecified'` before it
 * knows; MorrowBot starts dark, like the desktop app.
 */
export function themeFor(scheme: string | null | undefined): Theme {
  return scheme === 'light' ? THEMES.light : THEMES.dark;
}

export interface TextStyleToken {
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly fontWeight: '400' | '500' | '600' | '700';
}

/** iOS-sized type scale; desktop's rem scale reads too small on a phone. */
export const typography: Readonly<Record<'meta' | 'small' | 'ui' | 'body' | 'title' | 'largeTitle', TextStyleToken>> = {
  meta: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  ui: { fontSize: 15, lineHeight: 20, fontWeight: '400' },
  body: { fontSize: 17, lineHeight: 24, fontWeight: '400' },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  largeTitle: { fontSize: 30, lineHeight: 36, fontWeight: '700' },
};

export const spacing: Readonly<Record<1 | 2 | 3 | 4 | 5 | 6 | 8, number>> = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
};

export const radii: Readonly<Record<'sm' | 'md' | 'lg' | 'xl' | 'pill', number>> = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  pill: 999,
};

/** Agent avatars are 44pt circles, the iOS minimum hit target. */
export const AVATAR_SIZE = 44;
