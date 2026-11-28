import { ProviderInfo } from '@morrowbot/contracts';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { newBinding, type ProviderChoice } from '../../shared/binding-ui/selection.ts';
import { BrainFields } from './BrainFields.tsx';

const CHOICE: ProviderChoice = {
  id: 'claude',
  name: 'Claude',
  runtime: 'Claude Code',
  enabled: true,
  down: null,
  info: ProviderInfo.parse({
    kind: 'ready',
    version: '2.1.332',
    accountKey: '',
    accountLabel: null,
    warning: null,
    capabilities: {
      profiles: [
        { access: 'read-only', vendorSettings: 'isolated', modes: ['interactive'], readsOutsideCwd: false },
        { access: 'workspace-write', vendorSettings: 'isolated', modes: ['interactive'], readsOutsideCwd: false },
        { access: 'full', vendorSettings: 'isolated', modes: ['interactive'], readsOutsideCwd: true },
      ],
      approvals: true,
      sessions: true,
      usage: 'none',
      withheld: [{ access: 'full', vendorSettings: 'personal', reason: 'Not verified for personal setup.' }],
    },
    models: [
      {
        id: 'sonnet',
        label: 'Sonnet',
        isDefault: true,
        options: [{ id: 'effort', label: 'Effort', defaultChoiceId: 'medium', choices: [{ id: 'low', label: 'Low' }, { id: 'medium', label: 'Medium' }] }],
      },
    ],
  }),
};

function inspect(showAccess: boolean) {
  const html = renderToString(
    h(BrainFields, {
      choices: [CHOICE],
      value: newBinding(CHOICE),
      showAccess,
      redact: (text: string) => text,
      onChange: () => undefined,
      onOpenProviders: () => undefined,
    }),
  );
  return {
    hasModels: html.includes('Sonnet') && html.includes('Effort'),
    hasAccessSegment: html.includes('access-segment'),
    hasWarningNote: html.includes('binding-note warn'),
    hasUnavailable: html.includes('Unavailable') || html.includes('withheld'),
  };
}

it('hides access controls and warnings during New Agent creation, and shows concise access controls in Agent Settings', () => {
  expect({ newAgent: inspect(false), agentSettings: inspect(true) }).toMatchInlineSnapshot(`
    {
      "agentSettings": {
        "hasAccessSegment": true,
        "hasModels": true,
        "hasUnavailable": false,
        "hasWarningNote": true,
      },
      "newAgent": {
        "hasAccessSegment": false,
        "hasModels": true,
        "hasUnavailable": false,
        "hasWarningNote": false,
      },
    }
  `);
});
