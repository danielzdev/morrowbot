import type { Modifier } from './protocol.ts';

/** macOS virtual key codes (Carbon `kVK_*`), named by what they print on a US keyboard. */
const KEY_CODES: Readonly<Record<string, number>> = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17,
  '1': 18, '2': 19, '3': 20, '4': 21, '6': 22, '5': 23, '=': 24, '9': 25, '7': 26, '-': 27, '8': 28, '0': 29,
  ']': 30, o: 31, u: 32, '[': 33, i: 34, p: 35, return: 36, l: 37, j: 38, "'": 39, k: 40, ';': 41, '\\': 42,
  ',': 43, '/': 44, n: 45, m: 46, '.': 47, tab: 48, space: 49, '`': 50, delete: 51, escape: 53,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
  home: 115, pageup: 116, forwarddelete: 117, end: 119, pagedown: 121, left: 123, right: 124, down: 125, up: 126,
};

const KEY_ALIASES: Readonly<Record<string, string>> = { enter: 'return', backspace: 'delete', esc: 'escape' };

const MODIFIERS: Readonly<Record<string, Modifier>> = {
  command: 'command', cmd: 'command', shift: 'shift', option: 'option', alt: 'option', opt: 'option', control: 'control', ctrl: 'control', fn: 'fn',
};

export type Chord =
  | { readonly kind: 'chord'; readonly keyCode: number; readonly modifiers: readonly Modifier[] }
  | { readonly kind: 'invalid'; readonly reason: string };

/** Reads a key combination like `["command", "shift", "t"]`: any modifiers plus exactly one other key. */
export function parseChord(keys: readonly string[]): Chord {
  const modifiers = new Set<Modifier>();
  const others: string[] = [];
  for (const raw of keys) {
    const name = raw.trim().toLowerCase();
    const modifier = MODIFIERS[name];
    if (modifier === undefined) others.push(name);
    else modifiers.add(modifier);
  }
  const [only, ...rest] = others;
  if (only === undefined || rest.length > 0) {
    return { kind: 'invalid', reason: `Give modifiers plus exactly one other key; got ${others.length === 0 ? 'none' : others.join(', ')}.` };
  }
  const keyCode = KEY_CODES[KEY_ALIASES[only] ?? only];
  if (keyCode === undefined) return { kind: 'invalid', reason: `Unknown key "${only}". Use a letter, digit, punctuation, return, tab, space, delete, escape, arrows (left/right/up/down), home, end, pageup, pagedown or f1–f12.` };
  return { kind: 'chord', keyCode, modifiers: [...modifiers] };
}
