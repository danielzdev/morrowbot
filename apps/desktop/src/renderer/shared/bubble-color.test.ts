import { describe, expect, it } from 'vitest';
import {
  BUBBLE_SWATCHES,
  bubbleStyleVars,
  contrastRatio,
  DEFAULT_CUSTOM_BUBBLE_COLOR,
  deriveBubblePalette,
  describeGlobalBubbleColor,
  normalizeHex,
  resolveBubbleStyle,
  swatchNameOf,
  type ResolvedTheme,
} from './bubble-color.ts';

const EXTREME_COLORS: readonly string[] = [
  '#000000',
  '#ffffff',
  '#ffff00',
  '#00ff00',
  '#00ffff',
  '#ff00ff',
  '#ff0000',
  '#0000ff',
  '#111111',
  '#f8f8f8',
  '#808080',
  '#b4ff00',
  '#ff6b00',
  '#00ffd5',
];

const THEMES: readonly ResolvedTheme[] = ['light', 'dark'];

describe('bubble-color resolver', () => {
  it('defaults the custom swatch to Sky and never purple/violet', () => {
    expect(DEFAULT_CUSTOM_BUBBLE_COLOR).toBe('#0ea5e9');
    expect(BUBBLE_SWATCHES[0]).toEqual({ name: 'Sky', color: '#0ea5e9' });
  });

  it('resolves precedence: per-agent override > global setting > bot avatar color', () => {
    const botColor = '#10b981';
    const globalCustom = '#0ea5e9';
    const agentCustom = '#f59e0b';

    const matchBot = resolveBubbleStyle({ global: { kind: 'match-bot' }, agentOverride: undefined, agentColor: botColor, theme: 'light' });
    const globalOff = resolveBubbleStyle({ global: { kind: 'off' }, agentOverride: undefined, agentColor: botColor, theme: 'light' });
    const globalPicked = resolveBubbleStyle({ global: { kind: 'custom', color: globalCustom }, agentOverride: undefined, agentColor: botColor, theme: 'light' });
    const agentOffOverGlobal = resolveBubbleStyle({ global: { kind: 'custom', color: globalCustom }, agentOverride: { kind: 'off' }, agentColor: botColor, theme: 'light' });
    const agentCustomOverOff = resolveBubbleStyle({ global: { kind: 'off' }, agentOverride: { kind: 'custom', color: agentCustom }, agentColor: botColor, theme: 'light' });
    const agentCustomOverBot = resolveBubbleStyle({ global: { kind: 'match-bot' }, agentOverride: { kind: 'custom', color: agentCustom }, agentColor: botColor, theme: 'dark' });

    const summarize = (resolved: ReturnType<typeof resolveBubbleStyle>) =>
      resolved.kind === 'default' ? 'default' : `${resolved.origin}:${resolved.sourceColor}`;

    expect({
      matchBot: summarize(matchBot),
      globalOff: summarize(globalOff),
      globalPicked: summarize(globalPicked),
      agentOffOverGlobal: summarize(agentOffOverGlobal),
      agentCustomOverOff: summarize(agentCustomOverOff),
      agentCustomOverBot: summarize(agentCustomOverBot),
    }).toEqual({
      matchBot: 'bot:#10b981',
      globalOff: 'default',
      globalPicked: 'global-custom:#0ea5e9',
      agentOffOverGlobal: 'default',
      agentCustomOverOff: 'agent-override:#f59e0b',
      agentCustomOverBot: 'agent-override:#f59e0b',
    });
  });

  it('guarantees WCAG AA (>= 4.5:1) contrast for every built-in swatch and extreme custom hex in light and dark mode', () => {
    const allColors = [...BUBBLE_SWATCHES.map((swatch) => swatch.color), ...EXTREME_COLORS];
    const failures: string[] = [];
    for (const theme of THEMES) {
      for (const color of allColors) {
        const palette = deriveBubblePalette(color, theme);
        const fgRatio = contrastRatio(palette.foreground, palette.background);
        const mutedRatio = contrastRatio(palette.muted, palette.background);
        if (fgRatio < 4.5) failures.push(`${theme} ${color} fg=${fgRatio.toFixed(2)} (${palette.foreground} on ${palette.background})`);
        if (mutedRatio < 4.5) failures.push(`${theme} ${color} muted=${mutedRatio.toFixed(2)} (${palette.muted} on ${palette.background})`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('keeps #ffffff in light mode and #000000 in dark mode visually distinct from the chat canvas', () => {
    const whiteLight = deriveBubblePalette('#ffffff', 'light');
    const blackDark = deriveBubblePalette('#000000', 'dark');
    expect(whiteLight.background).not.toBe('#ffffff');
    expect(blackDark.background).not.toBe('#0a0a0b');
    expect(blackDark.background).not.toBe('#000000');
  });

  it('emits light-dark() CSS variables when tinted and undefined when neutral', () => {
    expect(bubbleStyleVars({ global: { kind: 'off' }, agentOverride: undefined, agentColor: '#0ea5e9' })).toBeUndefined();
    const vars = bubbleStyleVars({ global: { kind: 'match-bot' }, agentOverride: undefined, agentColor: '#0ea5e9' });
    expect(vars).toBeDefined();
    expect(vars?.['--user-bubble-bg']).toMatch(/^light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\)$/);
    expect(vars?.['--user-bubble-border']).toMatch(/^light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\)$/);
    expect(vars?.['--user-bubble-fg']).toMatch(/^light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\)$/);
    expect(vars?.['--user-bubble-muted']).toMatch(/^light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\)$/);
  });

  it('normalizes hex inputs and describes global modes cleanly', () => {
    expect({
      validWithHash: normalizeHex(' #0EA5E9 '),
      validNoHash: normalizeHex('FF00aa'),
      invalidShort: normalizeHex('#fff'),
      invalidChars: normalizeHex('#zzzzzz'),
      swatchSky: swatchNameOf('#0EA5E9'),
      customHex: swatchNameOf('#123456'),
      matchBot: describeGlobalBubbleColor({ kind: 'match-bot' }),
      off: describeGlobalBubbleColor({ kind: 'off' }),
      custom: describeGlobalBubbleColor({ kind: 'custom', color: '#0ea5e9' }),
    }).toEqual({
      validWithHash: '#0ea5e9',
      validNoHash: '#ff00aa',
      invalidShort: null,
      invalidChars: null,
      swatchSky: 'Sky',
      customHex: '#123456',
      matchBot: 'Matches bot',
      off: 'Default (neutral)',
      custom: 'Custom (Sky)',
    });
  });
});
