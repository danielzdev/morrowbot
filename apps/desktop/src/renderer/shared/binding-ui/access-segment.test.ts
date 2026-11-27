import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { AccessSegment } from './AccessSegment.tsx';
import type { AccessState } from './binding-state.ts';

const STATE: AccessState = {
  offered: [{ access: 'read-only', vendorSettings: 'personal', modes: ['interactive'], readsOutsideCwd: true }],
  withheld: [{ access: 'workspace-write', vendorSettings: 'personal', reason: 'Not checked yet on /Users/tester/work for tester.' }],
  approvals: false,
  current: { kind: 'not-offered' },
};

it('gives each withheld segment its redacted reason as aria-description, and lists it under Unavailable', () => {
  const html = renderToString(
    h(AccessSegment, {
      state: STATE,
      value: { access: 'read-only', vendorSettings: 'personal' },
      disabled: false,
      redact: (text: string) => text.replaceAll('/Users/tester', '~').replaceAll('tester', 'USER'),
      onPick: () => undefined,
    }),
  );
  const segments = [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(([, attributes = '', inner = '']) => ({
    label: inner.replace(/<[^>]+>/g, ''),
    checked: /aria-checked="true"/.test(attributes),
    disabled: /\bdisabled\b/.test(attributes.replace(/aria-disabled="[^"]*"/, '')),
    description: /aria-description="([^"]*)"/.exec(attributes)?.[1] ?? null,
  }));
  const unavailable = /<ul>(.*?)<\/ul>/.exec(html)?.[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  expect({ segments, unavailable }).toMatchInlineSnapshot(`
    {
      "segments": [
        {
          "checked": true,
          "description": null,
          "disabled": false,
          "label": "Read only · Personal setup",
        },
        {
          "checked": false,
          "description": "Not checked yet on ~/work for USER.",
          "disabled": true,
          "label": "Edit workspace · Personal setup",
        },
      ],
      "unavailable": "Edit workspace · Personal setup : Not checked yet on ~/work for USER.",
    }
  `);
});
