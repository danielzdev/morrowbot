import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

type Theme = 'light' | 'dark';
interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const css = readFileSync(new URL('../renderer/styles/tokens.css', import.meta.url), 'utf8');
const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';

function parseColor(text: string): Rgba {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(text);
  if (hex) return { r: parseInt(hex[1] ?? '', 16), g: parseInt(hex[2] ?? '', 16), b: parseInt(hex[3] ?? '', 16), a: 1 };
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(text);
  if (rgba) return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: Number(rgba[4]) };
  throw new Error(`Not a colour token value: ${text}`);
}

/** Every `--name: light-dark(light, dark)` colour token of the default block. */
const tokens = new Map<string, Record<Theme, Rgba>>(
  [...rootBlock.matchAll(/--([\w-]+):\s*light-dark\(((?:#\w+|rgba\([^)]*\))),\s*((?:#\w+|rgba\([^)]*\)))\);/g)].map((match) => [
    match[1] ?? '',
    { light: parseColor(match[2] ?? ''), dark: parseColor(match[3] ?? '') },
  ]),
);

function token(name: string, theme: Theme): Rgba {
  const value = tokens.get(name)?.[theme];
  if (value === undefined) throw new Error(`Missing token --${name}`);
  return value;
}

const over = (top: Rgba, under: Rgba): Rgba => ({
  r: top.r * top.a + under.r * (1 - top.a),
  g: top.g * top.a + under.g * (1 - top.a),
  b: top.b * top.a + under.b * (1 - top.a),
  a: 1,
});

function luminance({ r, g, b }: Rgba): number {
  const channel = (value: number): number => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(fg: Rgba, bg: Rgba): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const SURFACES = ['surface-0', 'surface-1', 'surface-2', 'surface-3'];
const UNDER_STATES = ['surface-1', 'surface-2', 'surface-3', 'surface-user'];

/** Every background a foreground token sits on (spec §1.1 "Where the targets apply"), alpha composited. */
function backgrounds(theme: Theme, own: string | null): ReadonlyMap<string, Rgba> {
  const all = new Map<string, Rgba>();
  for (const name of [...SURFACES, 'surface-user']) all.set(name, token(name, theme));
  for (const state of ['hover', 'selected']) for (const under of UNDER_STATES) all.set(`${state}/${under}`, over(token(state, theme), token(under, theme)));
  for (const under of SURFACES) all.set(`accent-soft/${under}`, over(token('accent-soft', theme), token(under, theme)));
  if (own !== null) for (const under of SURFACES) all.set(`${own}/${under}`, over(token(own, theme), token(under, theme)));
  return all;
}

const TARGETS: readonly { readonly name: string; readonly min: number; readonly own: string | null }[] = [
  { name: 'text-1', min: 7, own: null },
  { name: 'text-2', min: 4.5, own: null },
  { name: 'text-3', min: 4.5, own: null },
  { name: 'ok', min: 4.5, own: 'ok-bg' },
  { name: 'warn', min: 4.5, own: 'warn-bg' },
  { name: 'danger', min: 4.5, own: 'danger-bg' },
  { name: 'info', min: 4.5, own: 'info-bg' },
  { name: 'control-edge', min: 3, own: null },
  { name: 'accent', min: 3, own: null },
];

function worst(name: string, theme: Theme, own: string | null): { readonly ratio: number; readonly on: string } {
  const fg = token(name, theme);
  let found = { ratio: Infinity, on: '' };
  for (const [on, bg] of backgrounds(theme, own)) {
    const value = ratio(fg, bg);
    if (value < found.ratio) found = { ratio: value, on };
  }
  return found;
}

const round = (value: number): number => Math.floor(value * 100) / 100;

it('meets every §1.1 contrast target on every composited background, in both themes', () => {
  const failures: string[] = [];
  const table: Record<string, string> = {};
  for (const { name, min, own } of TARGETS) {
    const cells = (['dark', 'light'] as const).map((theme) => {
      const found = worst(name, theme, own);
      if (found.ratio < min) failures.push(`${theme} --${name} ${found.ratio.toFixed(2)} on ${found.on} (needs ${String(min)})`);
      return `${theme} ${round(found.ratio).toFixed(2)} on ${found.on}`;
    });
    table[name] = cells.join(' | ');
  }
  expect(failures).toEqual([]);
  expect(table).toMatchInlineSnapshot(`
    {
      "accent": "dark 5.85 on selected/surface-user | light 4.42 on selected/surface-user",
      "control-edge": "dark 3.07 on selected/surface-user | light 3.35 on selected/surface-user",
      "danger": "dark 4.71 on selected/surface-user | light 4.71 on selected/surface-user",
      "info": "dark 5.85 on selected/surface-user | light 4.75 on selected/surface-user",
      "ok": "dark 6.90 on ok-bg/surface-3 | light 4.69 on selected/surface-user",
      "text-1": "dark 12.13 on selected/surface-user | light 14.16 on selected/surface-user",
      "text-2": "dark 5.40 on selected/surface-user | light 5.97 on selected/surface-user",
      "text-3": "dark 4.52 on selected/surface-user | light 4.72 on selected/surface-user",
      "warn": "dark 7.23 on warn-bg/surface-3 | light 4.85 on selected/surface-user",
    }
  `);
});

it('keeps text on solid primary, accent and danger fills readable, and accent text on surfaces', () => {
  const pairs = (['dark', 'light'] as const).flatMap((theme) => [
    { pair: `${theme} on-accent/accent`, ratio: ratio(token('on-accent', theme), token('accent', theme)), min: 4.5 },
    { pair: `${theme} on-accent/accent-hover`, ratio: ratio(token('on-accent', theme), token('accent-hover', theme)), min: 4.5 },
    { pair: `${theme} on-primary/primary`, ratio: ratio(token('on-primary', theme), token('primary', theme)), min: 4.5 },
    { pair: `${theme} on-primary/primary-hover`, ratio: ratio(token('on-primary', theme), token('primary-hover', theme)), min: 4.5 },
    { pair: `${theme} on-danger/danger`, ratio: ratio(token('on-danger', theme), token('danger', theme)), min: 4.5 },
    { pair: `${theme} on-danger/danger-hover`, ratio: ratio(token('on-danger', theme), token('danger-hover', theme)), min: 4.5 },
    ...SURFACES.map((surface) => ({ pair: `${theme} accent/${surface}`, ratio: ratio(token('accent', theme), token(surface, theme)), min: 4.5 })),
  ]);
  expect(pairs.filter(({ ratio: value, min }) => value < min).map(({ pair, ratio: value }) => `${pair} ${value.toFixed(2)}`)).toEqual([]);
});
