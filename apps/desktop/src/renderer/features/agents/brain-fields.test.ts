import { DEFAULT_AVATAR, ProviderInfo, type Agent } from '@morrowbot/contracts';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { newBinding, type ProviderChoice } from '../../shared/binding-ui/selection.ts';
import { AgentPermissions } from './AgentPermissions.tsx';
import { BrainFields } from './BrainFields.tsx';

const WITHHELD_REASON = 'Not verified for personal setup.';

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
      withheld: [{ access: 'full', vendorSettings: 'personal', reason: WITHHELD_REASON }],
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

const segments = (html: string): readonly string[] =>
  [...html.matchAll(/<button[^>]*aria-checked="(true|false)"[^>]*>(.*?)<\/button>/g)].map(
    ([, checked = '', inner = '']) => `${inner.replace(/<[^>]+>/g, '').trim()}${checked === 'true' ? ' (chosen)' : ''}`,
  );

function brain(keepAccess: boolean) {
  const html = renderToString(
    h(BrainFields, {
      choices: [CHOICE],
      value: newBinding(CHOICE),
      keepAccess,
      allowFull: true,
      redact: (text: string) => text,
      onChange: () => undefined,
      onOpenProviders: () => undefined,
    }),
  );
  return { hasModels: html.includes('Sonnet') && html.includes('Effort'), hasAccess: html.includes('access-segment') };
}

function permissions(access: 'read-only' | 'full', allowFull: boolean) {
  const agent: Agent = {
    id: 'agent-1',
    name: 'Helper',
    description: '',
    workspace: { kind: 'dedicated', dir: '/work' },
    avatar: DEFAULT_AVATAR,
    provider: { kind: 'bound', pluginId: 'claude', selection: { kind: 'default' }, access, vendorSettings: 'isolated' },
    folderId: null,
    emojiReplies: 'allowed',
    disabledExtensions: [],
    revision: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const html = renderToString(
    h(AgentPermissions, {
      model: { updateAgent: () => new Promise<never>(() => undefined) },
      agent,
      choices: [CHOICE],
      allowFull,
      redact: (text: string) => text,
      onOpenProviders: () => undefined,
      onDirty: () => undefined,
    }),
  );
  return segments(html);
}

it('keeps access out of Brain and New Agent; Permissions offers full access only to the owner, or while it is already set', () => {
  expect({
    newAgent: brain(false),
    agentBrain: brain(true),
    ownerPermissions: permissions('read-only', true),
    memberPermissions: permissions('read-only', false),
    memberSeesFullAlreadySet: permissions('full', false),
  }).toMatchInlineSnapshot(`
    {
      "agentBrain": {
        "hasAccess": false,
        "hasModels": true,
      },
      "memberPermissions": [
        "Read only (chosen)",
        "Edit workspace",
      ],
      "memberSeesFullAlreadySet": [
        "Read only",
        "Edit workspace",
        "Full access (shell commands) (chosen)",
      ],
      "newAgent": {
        "hasAccess": false,
        "hasModels": true,
      },
      "ownerPermissions": [
        "Read only (chosen)",
        "Edit workspace",
        "Full access (shell commands)",
      ],
    }
  `);
});

it('shows the redacted saved-profile reason when a bound provider withholds every interactive profile', () => {
  const blocked: ProviderChoice = {
    ...CHOICE,
    info: ProviderInfo.parse({
      kind: 'ready',
      version: '2.1.332',
      accountKey: '',
      accountLabel: null,
      warning: null,
      capabilities: {
        profiles: [],
        approvals: true,
        sessions: true,
        usage: 'none',
        withheld: [{ access: 'full', vendorSettings: 'isolated', reason: 'Managed policy blocks /Users/tester/work.' }],
      },
      models: [],
    }),
  };
  const html = renderToString(
    h(BrainFields, {
      choices: [blocked],
      value: { kind: 'bound', pluginId: 'claude', selection: { kind: 'default' }, access: 'full', vendorSettings: 'isolated' },
      keepAccess: true,
      allowFull: true,
      redact: (text: string) => text.replaceAll('/Users/tester', '~'),
      onChange: () => undefined,
      onOpenProviders: () => undefined,
    }),
  );
  expect(html).toContain('Claude: Managed policy blocks ~/work.');
});
