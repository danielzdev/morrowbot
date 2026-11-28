import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { themeFor, type ThemeColors } from './theme.ts';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

const surfaces = ['surface0', 'surface1', 'surface2', 'surface3', 'surfaceUser'] satisfies (keyof ThemeColors)[];

describe('theme', () => {
  it('uses the Graphite signal-blue accent in both schemes', () => {
    expect({
      dark: themeFor('dark').colors.accent,
      light: themeFor('light').colors.accent,
      unknownStartsDark: themeFor(null).scheme,
    }).toMatchInlineSnapshot(`
      {
        "dark": "#74B9FF",
        "light": "#0B5FC5",
        "unknownStartsDark": "dark",
      }
    `);
  });

  it('matches the desktop tokens for every shared colour', () => {
    const css = readFileSync(
      join(import.meta.dirname, '../../../desktop/src/renderer/styles/tokens.css'),
      'utf8',
    );
    const desktop = new Map<string, { light: string; dark: string }>();
    for (const match of css.matchAll(/--([a-z0-9-]+): light-dark\((#[0-9A-F]{6}), (#[0-9A-F]{6})\)/g)) {
      const [, name = '', light = '', dark = ''] = match;
      desktop.set(name.replace(/-([a-z0-9])/g, (_: string, c: string) => c.toUpperCase()), { light, dark });
    }
    for (const scheme of ['light', 'dark'] as const) {
      const colors = new Map<string, string>(Object.entries(themeFor(scheme).colors));
      for (const [name, value] of desktop) {
        const mobile = colors.get(name);
        if (mobile !== undefined) expect(`${name}=${mobile}`).toBe(`${name}=${value[scheme]}`);
      }
    }
    expect(desktop.size).toBeGreaterThan(10);
  });

  it('meets the spec contrast targets on every opaque surface', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const { colors } = themeFor(scheme);
      for (const surface of surfaces) {
        const background = colors[surface];
        expect(contrast(colors.text1, background)).toBeGreaterThanOrEqual(7);
        expect(contrast(colors.text3, background)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(colors.accent, background)).toBeGreaterThanOrEqual(3);
      }
      expect(contrast(colors.onAccent, colors.accent)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
