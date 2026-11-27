import { ProviderInfo, type ModelSelection, type ProviderBinding } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { changeCheck } from '../../shared/binding-ui/binding-state.ts';
import { isAutoSelectable, isRunnable, newBinding, pinModel, prefill, readinessOf, statusLine, type ProviderChoice } from '../../shared/binding-ui/selection.ts';
import { accessPill, bindingPill, composerWarnings, sendBlock, type BoundProvider } from './binding-display.ts';

const ISOLATED_READ = { access: 'read-only', vendorSettings: 'isolated', modes: ['interactive', 'background'], readsOutsideCwd: false };
const ISOLATED_WRITE = { access: 'workspace-write', vendorSettings: 'isolated', modes: ['interactive'], readsOutsideCwd: false };
const PERSONAL_READ = { access: 'read-only', vendorSettings: 'personal', modes: ['interactive', 'background'], readsOutsideCwd: true };
const EFFORT = { id: 'effort', label: 'Effort', defaultChoiceId: 'high', choices: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }] };

const ready = (fields: object): ProviderInfo =>
  ProviderInfo.parse({
    kind: 'ready',
    version: '1.0.0',
    accountKey: '',
    accountLabel: null,
    warning: null,
    capabilities: { profiles: [ISOLATED_READ, ISOLATED_WRITE], approvals: true, sessions: true, usage: 'none', withheld: [] },
    models: [
      { id: 'haiku-4-5', label: 'Haiku 4.5', isDefault: false, options: [] },
      { id: 'opus', label: 'Opus', isDefault: true, options: [EFFORT] },
    ],
    ...fields,
  });

const choice = (id: string, info: ProviderInfo | undefined, extra: Partial<ProviderChoice> = {}): ProviderChoice => ({
  id,
  name: id,
  runtime: `${id} CLI`,
  enabled: true,
  info,
  down: null,
  ...extra,
});

const CODEX_CAPABILITIES = {
  profiles: [PERSONAL_READ],
  approvals: false,
  sessions: true,
  usage: 'live',
  withheld: [{ access: 'workspace-write', vendorSettings: 'personal', reason: 'Stop cannot end every command yet.' }],
};

const PROVIDERS: readonly ProviderChoice[] = [
  choice('turned-off', ready({}), { enabled: false }),
  choice('legacy-warning', ready({ warning: 'untested CLI version' })),
  choice('stopped', undefined, { down: 'Stopped unexpectedly' }),
  choice('background-only', ready({ capabilities: { profiles: [{ ...ISOLATED_READ, modes: ['background'] }], approvals: false, sessions: true, usage: 'none', withheld: [] } })),
  choice('codex', ready({ capabilities: CODEX_CAPABILITIES, models: [] })),
  choice('models-later', ProviderInfo.parse({ kind: 'ready-models-later', version: '1.0.0', accountKey: '', accountLabel: null, warning: null, capabilities: CODEX_CAPABILITIES })),
  choice('claude', ready({})),
];

it('prefills the first provider that can run with no warning, and never one that is off, down or warned', () => {
  expect({
    prefill: prefill(PROVIDERS)?.id,
    rows: Object.fromEntries(PROVIDERS.map((each) => [each.id, { status: statusLine(readinessOf(each)), runnable: isRunnable(each), auto: isAutoSelectable(each) }])),
  }).toMatchInlineSnapshot(`
    {
      "prefill": "codex",
      "rows": {
        "background-only": {
          "auto": false,
          "runnable": false,
          "status": "No interactive access is available",
        },
        "claude": {
          "auto": true,
          "runnable": true,
          "status": "Ready",
        },
        "codex": {
          "auto": true,
          "runnable": true,
          "status": "Ready",
        },
        "legacy-warning": {
          "auto": false,
          "runnable": true,
          "status": "Ready · Review this provider's status",
        },
        "models-later": {
          "auto": true,
          "runnable": true,
          "status": "Ready",
        },
        "stopped": {
          "auto": false,
          "runnable": false,
          "status": "Stopped unexpectedly",
        },
        "turned-off": {
          "auto": false,
          "runnable": false,
          "status": "Turned off",
        },
      },
    }
  `);
});

it('binds a new agent to the Recommended model at its default options, and the first warning-free access', () => {
  expect(Object.fromEntries(PROVIDERS.map((each) => [each.id, newBinding(each)]))).toMatchInlineSnapshot(`
    {
      "background-only": {
        "kind": "unbound",
      },
      "claude": {
        "access": "read-only",
        "kind": "bound",
        "pluginId": "claude",
        "selection": {
          "choices": {
            "effort": "high",
          },
          "id": "opus",
          "kind": "model",
        },
        "vendorSettings": "isolated",
      },
      "codex": {
        "access": "read-only",
        "kind": "bound",
        "pluginId": "codex",
        "selection": {
          "kind": "default",
        },
        "vendorSettings": "personal",
      },
      "legacy-warning": {
        "access": "read-only",
        "kind": "bound",
        "pluginId": "legacy-warning",
        "selection": {
          "choices": {
            "effort": "high",
          },
          "id": "opus",
          "kind": "model",
        },
        "vendorSettings": "isolated",
      },
      "models-later": {
        "access": "read-only",
        "kind": "bound",
        "pluginId": "models-later",
        "selection": {
          "kind": "default",
        },
        "vendorSettings": "personal",
      },
      "stopped": {
        "kind": "unbound",
      },
      "turned-off": {
        "kind": "unbound",
      },
    }
  `);
});

const ISOLATED_READ_KEY: Pick<BoundProvider, 'access' | 'vendorSettings'> = { access: 'read-only', vendorSettings: 'isolated' };
const bound = (pluginId: string, selection: ModelSelection, access: Pick<BoundProvider, 'access' | 'vendorSettings'> = ISOLATED_READ_KEY): ProviderBinding => ({
  kind: 'bound',
  pluginId,
  selection,
  access: access.access,
  vendorSettings: access.vendorSettings,
});
const OPUS_LOW: ModelSelection = { kind: 'model', id: 'opus', choices: { effort: 'low' } };

const CASES: readonly (readonly [string, ProviderBinding])[] = [
  ['pinned with effort', bound('claude', OPUS_LOW)],
  ['pinned, no options', bound('claude', { kind: 'model', id: 'haiku-4-5', choices: {} })],
  ['auto', bound('claude', { kind: 'default' })],
  ['auto before models are reported', bound('models-later', { kind: 'default' }, { access: 'read-only', vendorSettings: 'personal' })],
  ['model gone from the list', bound('claude', { kind: 'model', id: 'sonnet-3', choices: {} })],
  ['model not reported yet', bound('models-later', { kind: 'model', id: 'gpt-x', choices: {} }, { access: 'read-only', vendorSettings: 'personal' })],
  ['access withheld', bound('codex', { kind: 'default' }, { access: 'workspace-write', vendorSettings: 'personal' })],
  ['access with warnings', bound('codex', { kind: 'default' }, { access: 'read-only', vendorSettings: 'personal' })],
  ['legacy provider warning', bound('legacy-warning', OPUS_LOW)],
  ['provider turned off', bound('turned-off', OPUS_LOW)],
  ['provider stopped', bound('stopped', OPUS_LOW)],
  ['provider not installed', bound('gone', OPUS_LOW)],
  ['unbound', { kind: 'unbound' }],
];

const pill = ({ label, warn }: { readonly label: string; readonly warn: boolean }): string => (warn ? `${label} [warn]` : label);

it('shows each saved binding in the pills, blocks only what cannot send, and never names a model "Default"', () => {
  const shown = CASES.map(([name, binding]) => {
    const provider = binding.kind === 'bound' ? PROVIDERS.find(({ id }) => id === binding.pluginId) : undefined;
    const pills = binding.kind === 'bound' ? [pill(bindingPill(provider, binding)), pill(accessPill(provider, binding))] : [];
    const warnings = composerWarnings(provider, binding).map((warning) => (warning.kind === 'profile' ? warning.text : 'Review this provider’s status'));
    return [name, { pills, block: sendBlock('Helper', provider, binding), warnings }];
  });
  expect(shown.filter(([, view]) => JSON.stringify(view).includes('"Default')).length).toBe(0);
  expect(Object.fromEntries(shown)).toMatchInlineSnapshot(`
    {
      "access with warnings": {
        "block": null,
        "pills": [
          "Auto · chosen by codex CLI",
          "Read only · Personal setup [warn]",
        ],
        "warnings": [
          "Can read your files outside the workspace.",
          "Also loads your personal CLI instructions.",
        ],
      },
      "access withheld": {
        "block": "This agent's access isn't offered. Pick another in the access menu.",
        "pills": [
          "Auto · chosen by codex CLI",
          "Edit workspace · Personal setup (unavailable) [warn]",
        ],
        "warnings": [],
      },
      "auto": {
        "block": null,
        "pills": [
          "Auto · chosen by claude CLI",
          "Read only",
        ],
        "warnings": [],
      },
      "auto before models are reported": {
        "block": null,
        "pills": [
          "models-later · chosen by models-later CLI",
          "Read only · Personal setup [warn]",
        ],
        "warnings": [
          "Can read your files outside the workspace.",
          "Also loads your personal CLI instructions.",
        ],
      },
      "legacy provider warning": {
        "block": null,
        "pills": [
          "Opus · Low",
          "Read only",
        ],
        "warnings": [
          "Review this provider’s status",
        ],
      },
      "model gone from the list": {
        "block": "Pick another model",
        "pills": [
          "sonnet-3 (unavailable) [warn]",
          "Read only",
        ],
        "warnings": [],
      },
      "model not reported yet": {
        "block": null,
        "pills": [
          "gpt-x · availability not reported",
          "Read only · Personal setup [warn]",
        ],
        "warnings": [
          "Can read your files outside the workspace.",
          "Also loads your personal CLI instructions.",
        ],
      },
      "pinned with effort": {
        "block": null,
        "pills": [
          "Opus · Low",
          "Read only",
        ],
        "warnings": [],
      },
      "pinned, no options": {
        "block": null,
        "pills": [
          "Haiku 4.5",
          "Read only",
        ],
        "warnings": [],
      },
      "provider not installed": {
        "block": "This agent's provider isn't installed.",
        "pills": [
          "Provider not installed [warn]",
          "Read only",
        ],
        "warnings": [],
      },
      "provider stopped": {
        "block": "stopped: Stopped unexpectedly",
        "pills": [
          "stopped · Stopped unexpectedly [warn]",
          "Read only",
        ],
        "warnings": [],
      },
      "provider turned off": {
        "block": "turned-off: Turned off",
        "pills": [
          "turned-off · Turned off [warn]",
          "Read only",
        ],
        "warnings": [],
      },
      "unbound": {
        "block": "Choose a provider for Helper",
        "pills": [],
        "warnings": [],
      },
    }
  `);
});

it('asks first for a provider switch or an access that adds a warning, and never for one that keeps or drops warnings', () => {
  const personal = (access: 'read-only' | 'workspace-write'): Pick<BoundProvider, 'access' | 'vendorSettings'> => ({ access, vendorSettings: 'personal' });
  const both: ProviderChoice = choice('both', ready({ capabilities: { ...CODEX_CAPABILITIES, profiles: [PERSONAL_READ, { ...PERSONAL_READ, access: 'workspace-write', readsOutsideCwd: false }, ISOLATED_READ] } }));
  const choices = [...PROVIDERS, both];
  const auto: ModelSelection = { kind: 'default' };
  const steps: readonly (readonly [string, ProviderBinding, ProviderBinding])[] = [
    ['switch provider', bound('claude', auto), bound('codex', auto, personal('read-only'))],
    ['access adds warnings', bound('both', auto), bound('both', auto, personal('read-only'))],
    ['access keeps a warning, drops one', bound('both', auto, personal('read-only')), bound('both', auto, personal('workspace-write'))],
    ['access drops warnings', bound('both', auto, personal('read-only')), bound('both', auto)],
    ['first binding', { kind: 'unbound' }, bound('claude', auto)],
  ];
  expect(Object.fromEntries(steps.map(([name, before, after]) => [name, changeCheck(choices, before, after)]))).toMatchInlineSnapshot(`
    {
      "access adds warnings": {
        "added": [
          "Can read your files outside the workspace.",
          "Also loads your personal CLI instructions.",
        ],
        "switched": false,
      },
      "access drops warnings": {
        "added": [],
        "switched": false,
      },
      "access keeps a warning, drops one": {
        "added": [],
        "switched": false,
      },
      "first binding": {
        "added": [],
        "switched": true,
      },
      "switch provider": {
        "added": [
          "Can read your files outside the workspace.",
          "Also loads your personal CLI instructions.",
        ],
        "switched": true,
      },
    }
  `);
});

it('pins a picked model with each option at its default', () => {
  const info = ready({});
  expect(info.kind === 'ready' ? info.models.map(pinModel) : null).toMatchInlineSnapshot(`
    [
      {
        "choices": {},
        "id": "haiku-4-5",
        "kind": "model",
      },
      {
        "choices": {
          "effort": "high",
        },
        "id": "opus",
        "kind": "model",
      },
    ]
  `);
});
