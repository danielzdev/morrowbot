import { z } from 'zod';

/** A normalized lowercase #rrggbb color string. */
export const HexColor = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, 'Use a #rrggbb color')
  .transform((value) => value.toLowerCase());
export type HexColor = z.infer<typeof HexColor>;

/** Default custom bubble swatch: Sky (never purple/violet). */
export const DEFAULT_CUSTOM_BUBBLE_COLOR: HexColor = '#0ea5e9';

/** Curated bubble color swatches matching the app palette, starting with Sky. */
export const BUBBLE_SWATCHES: readonly { readonly name: string; readonly color: HexColor }[] = [
  { name: 'Sky', color: '#0ea5e9' },
  { name: 'Mint', color: '#10b981' },
  { name: 'Amber', color: '#f59e0b' },
  { name: 'Coral', color: '#ef4444' },
  { name: 'Rose', color: '#ec4899' },
  { name: 'Ocean', color: '#2563eb' },
  { name: 'Copper', color: '#b55b29' },
  { name: 'Slate', color: '#6b7280' },
];

/** Global user message bubble mode. */
export const BubbleColorGlobal = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('match-bot') }),
  z.strictObject({ kind: z.literal('off') }),
  z.strictObject({ kind: z.literal('custom'), color: HexColor }),
]);
export type BubbleColorGlobal = z.infer<typeof BubbleColorGlobal>;

/** Per-agent override; absence in the map means "use global". */
export const BubbleColorOverride = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('off') }),
  z.strictObject({ kind: z.literal('custom'), color: HexColor }),
]);
export type BubbleColorOverride = z.infer<typeof BubbleColorOverride>;

export type ResolvedTheme = 'light' | 'dark';

export interface BubblePalette {
  readonly background: HexColor;
  readonly border: HexColor;
  readonly foreground: HexColor;
  readonly muted: HexColor;
}

export type BubbleOrigin = 'agent-override' | 'global-custom' | 'bot';

export type ResolvedBubbleStyle =
  | { readonly kind: 'default' }
  | { readonly kind: 'tinted'; readonly sourceColor: HexColor; readonly origin: BubbleOrigin; readonly palette: BubblePalette };

export interface ResolveBubbleInput {
  readonly global: BubbleColorGlobal;
  readonly agentOverride: BubbleColorOverride | undefined;
  readonly agentColor: string;
  readonly theme: ResolvedTheme;
}

const WCAG_AA = 4.5;
const WCAG_AAA = 7.0;

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

interface Hsl {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Normalizes `#rrggbb` or `rrggbb` to lowercase `#rrggbb`, or null when invalid. */
export function normalizeHex(input: string): HexColor | null {
  const trimmed = input.trim();
  const candidate = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  const parsed = HexColor.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function parseRgb(hex: string): Rgb {
  const normalized = normalizeHex(hex) ?? DEFAULT_CUSTOM_BUBBLE_COLOR;
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function toHexByte(channel: number): string {
  return clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0');
}

function rgbToHex({ r, g, b }: Rgb): HexColor {
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  const h =
    max === rn
      ? 60 * (((gn - bn) / delta) % 6)
      : max === gn
        ? 60 * ((bn - rn) / delta + 2)
        : 60 * ((rn - gn) / delta + 4);
  return { h: (h + 360) % 360, s, l };
}

function hslToHex(h: number, s: number, l: number): HexColor {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 1);
  const lig = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lig - c / 2;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hue < 60) {
    r1 = c;
    g1 = x;
  } else if (hue < 120) {
    r1 = x;
    g1 = c;
  } else if (hue < 180) {
    g1 = c;
    b1 = x;
  } else if (hue < 240) {
    g1 = x;
    b1 = c;
  } else if (hue < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }
  return rgbToHex({ r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 });
}

function linearize(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.1 relative luminance in `[0, 1]`. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseRgb(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG 2.1 contrast ratio in `[1, 21]`. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function ensureContrast(candidate: HexColor, background: HexColor, target: number): HexColor {
  if (contrastRatio(candidate, background) >= target) return candidate;
  const darkInk: HexColor = '#111114';
  const lightInk: HexColor = '#f8f8fa';
  const darkRatio = contrastRatio(darkInk, background);
  const lightRatio = contrastRatio(lightInk, background);
  const bestSoft = darkRatio >= lightRatio ? darkInk : lightInk;
  if (contrastRatio(bestSoft, background) >= target) return bestSoft;
  return contrastRatio('#000000', background) >= contrastRatio('#ffffff', background) ? '#000000' : '#ffffff';
}

/**
 * Derives a tinted bubble background, subtle border, foreground and muted text color for a source
 * `#rrggbb` color in light or dark theme, always guaranteeing WCAG AA (>= 4.5:1) text contrast.
 */
export function deriveBubblePalette(hex: string, theme: ResolvedTheme): BubblePalette {
  const { h, s, l } = rgbToHsl(parseRgb(hex));
  const chromatic = s >= 0.08;
  switch (theme) {
    case 'light': {
      const bgL = chromatic ? (h >= 45 && h <= 165 ? 0.88 : 0.90) : 0.85 + l * 0.07;
      const bgS = chromatic ? clamp(s * 0.85, 0.14, 0.72) : 0.04;
      const hue = chromatic ? h : 240;
      const background = hslToHex(hue, bgS, bgL);
      const border = hslToHex(hue, chromatic ? clamp(bgS * 1.05, 0.16, 0.76) : 0.06, bgL - 0.13);
      const fgCandidate = chromatic ? hslToHex(hue, Math.min(s * 0.3, 0.28), 0.11) : '#17171a';
      const mutedCandidate = chromatic ? hslToHex(hue, Math.min(s * 0.26, 0.24), 0.29) : '#45454f';
      return {
        background,
        border,
        foreground: ensureContrast(fgCandidate, background, WCAG_AAA),
        muted: ensureContrast(mutedCandidate, background, WCAG_AA),
      };
    }
    case 'dark': {
      const bgL = chromatic ? (h >= 215 && h <= 275 ? 0.22 : 0.19) : 0.15 + l * 0.09;
      const bgS = chromatic ? clamp(s * 0.65, 0.12, 0.56) : 0.04;
      const hue = chromatic ? h : 240;
      const background = hslToHex(hue, bgS, bgL);
      const border = hslToHex(hue, chromatic ? clamp(bgS * 1.05, 0.15, 0.62) : 0.06, bgL + 0.13);
      const fgCandidate = chromatic ? hslToHex(hue, Math.min(s * 0.24, 0.24), 0.94) : '#ececee';
      const mutedCandidate = chromatic ? hslToHex(hue, Math.min(s * 0.22, 0.22), 0.75) : '#b4b4be';
      return {
        background,
        border,
        foreground: ensureContrast(fgCandidate, background, WCAG_AAA),
        muted: ensureContrast(mutedCandidate, background, WCAG_AA),
      };
    }
  }
}

type ResolvedSource =
  | { readonly kind: 'default' }
  | { readonly kind: 'tinted'; readonly sourceColor: HexColor; readonly origin: BubbleOrigin };

function resolveSource(input: Omit<ResolveBubbleInput, 'theme'>): ResolvedSource {
  if (input.agentOverride !== undefined) {
    switch (input.agentOverride.kind) {
      case 'off':
        return { kind: 'default' };
      case 'custom':
        return { kind: 'tinted', sourceColor: input.agentOverride.color, origin: 'agent-override' };
    }
  }
  switch (input.global.kind) {
    case 'off':
      return { kind: 'default' };
    case 'custom':
      return { kind: 'tinted', sourceColor: input.global.color, origin: 'global-custom' };
    case 'match-bot': {
      const normalized = normalizeHex(input.agentColor);
      return normalized === null ? { kind: 'default' } : { kind: 'tinted', sourceColor: normalized, origin: 'bot' };
    }
  }
}

/** Resolves the outgoing user bubble style with precedence: per-agent override > global > bot color. */
export function resolveBubbleStyle(input: ResolveBubbleInput): ResolvedBubbleStyle {
  const source = resolveSource(input);
  switch (source.kind) {
    case 'default':
      return source;
    case 'tinted':
      return { ...source, palette: deriveBubblePalette(source.sourceColor, input.theme) };
  }
}

/**
 * CSS custom properties for outgoing user bubbles using `light-dark(...)` so `data-theme="system"`
 * responds immediately to OS light/dark changes. Returns undefined for neutral default bubbles.
 */
export function bubbleStyleVars(input: Omit<ResolveBubbleInput, 'theme'>): Readonly<Record<string, string>> | undefined {
  const source = resolveSource(input);
  if (source.kind === 'default') return undefined;
  const light = deriveBubblePalette(source.sourceColor, 'light');
  const dark = deriveBubblePalette(source.sourceColor, 'dark');
  return {
    '--user-bubble-bg': `light-dark(${light.background}, ${dark.background})`,
    '--user-bubble-border': `light-dark(${light.border}, ${dark.border})`,
    '--user-bubble-fg': `light-dark(${light.foreground}, ${dark.foreground})`,
    '--user-bubble-muted': `light-dark(${light.muted}, ${dark.muted})`,
  };
}

/** Human-readable name for a color swatch, or its lowercase hex code. */
export function swatchNameOf(color: string): string {
  const normalized = normalizeHex(color);
  if (normalized === null) return color;
  return BUBBLE_SWATCHES.find((swatch) => swatch.color === normalized)?.name ?? normalized;
}

/** Describes what the global message color setting currently resolves to, for per-agent UI copy. */
export function describeGlobalBubbleColor(global: BubbleColorGlobal): string {
  switch (global.kind) {
    case 'match-bot':
      return 'Matches bot';
    case 'off':
      return 'Default (neutral)';
    case 'custom':
      return `Custom (${swatchNameOf(global.color)})`;
  }
}
