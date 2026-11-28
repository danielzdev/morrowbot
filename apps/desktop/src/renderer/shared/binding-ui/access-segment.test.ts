import { ProviderInfo } from '@morrowbot/contracts';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { AccessSegment } from './AccessSegment.tsx';
import { accessState, type AccessKey } from './binding-state.ts';

const INFO = ProviderInfo.parse({
  kind: 'ready',
  version: '1.0.0',
  accountKey: '',
  accountLabel: null,
  warning: null,
  capabilities: {
    profiles: [{ access: 'read-only', vendorSettings: 'personal', modes: ['interactive'], readsOutsideCwd: true }],
    approvals: false,
    sessions: false,
    usage: 'none',
    withheld: [{ access: 'workspace-write', vendorSettings: 'personal', reason: 'Not checked yet on /Users/tester/work for tester.' }],
  },
  models: [],
});

const redact = (text: string): string => text.replaceAll('/Users/tester', '~').replaceAll('tester', 'USER');

function render(value: AccessKey) {
  const html = renderToString(
    h(AccessSegment, {
      state: accessState(INFO, value),
      value,
      disabled: false,
      redact,
      onPick: () => undefined,
    }),
  );
  const segments = [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(([, attributes = '', inner = '']) => ({
    label: inner.replace(/<[^>]+>/g, ''),
    checked: /aria-checked="true"/.test(attributes),
    disabled: /\bdisabled\b/.test(attributes.replace(/aria-disabled="[^"]*"/, '')),
  }));
  const notes = [...html.matchAll(/<p class="binding-note[^"]*">(.*?)<\/p>/g)].map(([, inner = '']) => inner.replace(/<[^>]+>/g, '').trim());
  return { segments, notes, hasUnavailable: html.includes('Unavailable') || html.includes('withheld-list') };
}

it('shows only offered segments with no Unavailable list, while explaining a withheld saved profile', () => {
  expect({
    offered: render({ access: 'read-only', vendorSettings: 'personal' }),
    savedWithheld: render({ access: 'workspace-write', vendorSettings: 'personal' }),
  }).toMatchInlineSnapshot(`
    {
      "offered": {
        "hasUnavailable": false,
        "notes": [
          "Reads files in the workspace. Can't edit files. Can't run commands. Also loads your personal CLI instructions.",
          "Can read your files outside the workspace.",
          "Also loads your personal CLI instructions.",
        ],
        "segments": [
          {
            "checked": true,
            "disabled": false,
            "label": "Read only · Personal setup",
          },
        ],
      },
      "savedWithheld": {
        "hasUnavailable": false,
        "notes": [
          "This agent's access isn't available: Not checked yet on ~/work for USER. Pick an offered one.",
        ],
        "segments": [
          {
            "checked": false,
            "disabled": false,
            "label": "Read only · Personal setup",
          },
        ],
      },
    }
  `);
});
