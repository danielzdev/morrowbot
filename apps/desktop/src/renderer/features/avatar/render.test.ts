import type { AgentAvatar } from '@morrowbot/contracts';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { AvatarPicker } from './AvatarPicker.tsx';
import { BotAvatar } from './BotAvatar.tsx';
import { FINISHES } from './shapes.ts';

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

it('offers every finish in the picker and marks the chosen shape, color and finish', () => {
  const html = renderToString(h(AvatarPicker, { value: { ...AVATAR, color: '#EC4899', finish: 'metallic' }, onChange: () => undefined }));
  const finishes = html.slice(html.indexOf('aria-label="Finish"'));
  expect({
    checked: [...html.matchAll(/role="radio" aria-checked="true"[^>]*?(?:aria-label="([^"]+)"[^>]*>|>([^<]+)<)/g)].map((match) => match[1] ?? match[2]),
    finishes: [...finishes.matchAll(/aria-checked="(true|false)"[^>]*>([^<]+)</g)].map((match) => `${String(match[2])}${match[1] === 'true' ? ' (chosen)' : ''}`),
  }).toMatchInlineSnapshot(`
    {
      "checked": [
        "Mug",
        "#ec4899",
        "Metallic",
      ],
      "finishes": [
        "Flat",
        "Fluffy",
        "Matte",
        "Metallic (chosen)",
      ],
    }
  `);
});
