import { pairingUri } from '@morrowbot/contracts';
import { describe, expect, it } from 'vitest';
import { parsePairingFields, parsePairingLink } from './pairing-link.ts';

describe('parsePairingLink', () => {
  it('reads the QR payload the host makes, and refuses anything else', () => {
    expect(
      [
        pairingUri('http://100.64.0.1:47800', '042917'),
        'oribot://pair/?code=042917&url=https%3A%2F%2Fstudio.tail1234.ts.net',
        'oribot://pair?url=http%3A%2F%2F100.64.0.1%3A47800&code=12345',
        'oribot://pair?url=http%3A%2F%2F100.64.0.1%3A47800%2Fapi&code=042917',
        'oribot://pair?url=%E0%A4%A&code=042917',
        'https://example.com/pair?url=http%3A%2F%2F100.64.0.1&code=042917',
        'hello',
      ].map(parsePairingLink),
    ).toMatchInlineSnapshot(`
      [
        {
          "kind": "ok",
          "target": {
            "code": "042917",
            "url": "http://100.64.0.1:47800",
          },
        },
        {
          "kind": "ok",
          "target": {
            "code": "042917",
            "url": "https://studio.tail1234.ts.net",
          },
        },
        {
          "kind": "invalid",
          "problem": "Enter the 6-digit code shown on the desktop.",
        },
        {
          "kind": "invalid",
          "problem": "Enter the host address, such as http://100.64.0.1:47800.",
        },
        {
          "kind": "invalid",
          "problem": "This is not an Ori Bot pairing code.",
        },
        {
          "kind": "invalid",
          "problem": "This is not an Ori Bot pairing code.",
        },
        {
          "kind": "invalid",
          "problem": "This is not an Ori Bot pairing code.",
        },
      ]
    `);
  });
});

describe('parsePairingFields', () => {
  it('accepts a bare Tailscale address and a spaced code', () => {
    expect([
      parsePairingFields(' 100.64.0.1:47800 ', '042 917'),
      parsePairingFields('studio.tail1234.ts.net:47800/', '042917'),
      parsePairingFields('ftp://100.64.0.1', '042917'),
    ]).toMatchInlineSnapshot(`
      [
        {
          "kind": "ok",
          "target": {
            "code": "042917",
            "url": "http://100.64.0.1:47800",
          },
        },
        {
          "kind": "ok",
          "target": {
            "code": "042917",
            "url": "http://studio.tail1234.ts.net:47800",
          },
        },
        {
          "kind": "invalid",
          "problem": "Enter the host address, such as http://100.64.0.1:47800.",
        },
      ]
    `);
  });
});
