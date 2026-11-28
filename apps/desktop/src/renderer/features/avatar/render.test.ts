import type { AgentAvatar } from '@morrowbot/contracts';
import { validateAvatar, type AvatarDefinition } from 'open-bot-avatar';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { AvatarPicker } from './AvatarPicker.tsx';
import { BotAvatar } from './BotAvatar.tsx';
import { AVATARS, FINISHES } from './registry.ts';

const AVATAR: AgentAvatar = { kind: 'bot', shape: 'mug', color: '#10b981', finish: 'flat' };

/** The finish class, the filter the engine's element points at, and the filters drawn beside it. */
function finishOf(html: string) {
  return {
    class: /class="bot-avatar ([^"]+)"/.exec(html)?.[1],
    points: /filter:\s*url\(#([^)]+)\)/.exec(html)?.[1] ?? null,
    filters: [...html.matchAll(/<filter id="([^"]+)"/g)].map((match) => match[1]),
    lights: [...html.matchAll(/<(fe\w+Lighting)/g)].map((match) => match[1]),
  };
}

it('renders each finish: matte and metallic light the body with a filter of their own, flat and fluffy need none', () => {
  const rendered = Object.fromEntries(FINISHES.map((finish) => [finish, finishOf(renderToString(h(BotAvatar, { avatar: { ...AVATAR, finish }, size: 40 })))]));
  expect(Object.values(rendered).every(({ points, filters }) => points === null ? filters.length === 0 : filters.length === 1 && filters[0] === points)).toBe(true);
  expect(Object.fromEntries(Object.entries(rendered).map(([finish, { class: name, filters, lights }]) => [finish, { class: name, filtered: filters.length > 0, lights }])))
    .toMatchInlineSnapshot(`
      {
        "flat": {
          "class": "finish-flat",
          "filtered": false,
          "lights": [],
        },
        "fluffy": {
          "class": "finish-fluffy",
          "filtered": false,
          "lights": [],
        },
        "matte": {
          "class": "finish-matte",
          "filtered": true,
          "lights": [
            "feDiffuseLighting",
          ],
        },
        "metallic": {
          "class": "finish-metallic",
          "filtered": true,
          "lights": [
            "feDiffuseLighting",
            "feSpecularLighting",
          ],
        },
      }
    `);
});

it('gives every shape a definition the engine accepts', () => {
  const verdict = (definition: AvatarDefinition | undefined) => {
    if (definition === undefined) return 'missing';
    const result = validateAvatar(definition);
    return result.ok ? 'valid' : result.errors;
  };
  expect(Object.fromEntries(AVATARS.map(({ id, definition }) => [id, verdict(definition)]))).toMatchInlineSnapshot(`
    {
      "barbell": "valid",
      "bolt": "valid",
      "book": "valid",
      "chat": "valid",
      "cloud": "valid",
      "controller": "valid",
      "flame": "valid",
      "ghost": "valid",
      "heart": "valid",
      "lightbulb": "valid",
      "mug": "valid",
      "shield": "valid",
      "sprout": "valid",
      "star": "valid",
      "watering-can": "valid",
    }
  `);
});

/** Each picker radio as its name, marked when checked. */
function buttons(html: string): string[] {
  return [...html.matchAll(/<button([^>]*)>([^<]*)/g)].flatMap(([, attributes = '', text]) => {
    const pressed = /aria-checked="(true|false)"/.exec(attributes)?.[1];
    if (pressed === undefined) return [];
    const name = /aria-label="([^"]+)"/.exec(attributes)?.[1] ?? text;
    return [`${String(name)}${pressed === 'true' ? ' (chosen)' : ''}`];
  });
}

it('offers every shape, named swatch and finish in the picker and marks the chosen ones', () => {
  expect(buttons(renderToString(h(AvatarPicker, { value: { ...AVATAR, color: '#EC4899', finish: 'metallic' }, onChange: () => undefined })))).toMatchInlineSnapshot(`
    [
      "Chat",
      "Controller",
      "Barbell",
      "Mug (chosen)",
      "Lightbulb",
      "Sprout",
      "Watering can",
      "Star",
      "Cloud",
      "Bolt",
      "Flame",
      "Heart",
      "Book",
      "Ghost",
      "Shield",
      "Ocean",
      "Sky",
      "Mint",
      "Amber",
      "Coral",
      "Copper",
      "Rose (chosen)",
      "Slate",
      "Flat",
      "Fluffy",
      "Matte",
      "Metallic (chosen)",
    ]
  `);
});
