import { ProviderInfo, type AccessProfile } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import type { ProviderChoice } from '../../shared/binding-ui/selection.ts';
import type { BoundProvider } from './binding-display.ts';
import { favoriteRows, openingTab, pickedBinding } from './picker.ts';

const READ: AccessProfile = { access: 'read-only', vendorSettings: 'isolated', modes: ['interactive'], readsOutsideCwd: false };
const WRITE: AccessProfile = { ...READ, access: 'workspace-write' };
const FULL: AccessProfile = { ...READ, access: 'full', readsOutsideCwd: true };
const EFFORT = { id: 'effort', label: 'Effort', defaultChoiceId: 'high', choices: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }] };

const provider = (id: string, profiles: readonly AccessProfile[], models: readonly string[], extra: Partial<ProviderChoice> = {}): ProviderChoice => ({
  id,
  name: id,
  runtime: id,
  enabled: true,
  down: null,
  info: ProviderInfo.parse({
    kind: 'ready',
    version: '1.0.0',
    accountKey: '',
    accountLabel: null,
    warning: null,
    capabilities: { profiles, approvals: true, sessions: true, usage: 'none', withheld: [] },
    models: models.map((model, index) => ({ id: model, label: model.toUpperCase(), isDefault: index === 0, options: [EFFORT] })),
  }),
  ...extra,
});

const CLAUDE = provider('claude', [READ, WRITE, FULL], ['opus', 'haiku']);
const CODEX = provider('codex', [READ, WRITE], ['gpt-5']);
const OFF = provider('off', [READ], ['m1'], { enabled: false });
const CHOICES = [CLAUDE, CODEX, OFF];

const BOUND: BoundProvider = { kind: 'bound', pluginId: 'claude', selection: { kind: 'model', id: 'opus', choices: { effort: 'low' } }, access: 'workspace-write', vendorSettings: 'isolated' };

const summary = (binding: BoundProvider | null): string | null =>
  binding === null ? null : `${binding.pluginId} · ${binding.selection.kind === 'model' ? `${binding.selection.id} ${JSON.stringify(binding.selection.choices)}` : 'auto'} · ${binding.access}`;

it('lists only the starred models that can run now, in star order, and opens on Favorites only when there is one', () => {
  const starred = [
    { pluginId: 'codex', modelId: 'gpt-5' },
    { pluginId: 'claude', modelId: 'gone' },
    { pluginId: 'off', modelId: 'm1' },
    { pluginId: 'missing', modelId: 'x' },
    { pluginId: 'claude', modelId: 'haiku' },
  ];
  const rows = favoriteRows(CHOICES, starred);
  expect({
    rows: rows.map(({ choice, model }) => `${choice.name} · ${model.label}`),
    opensOn: openingTab(rows, BOUND),
    opensWithoutStars: openingTab(favoriteRows(CHOICES, []), BOUND),
  }).toMatchInlineSnapshot(`
    {
      "opensOn": {
        "kind": "favorites",
      },
      "opensWithoutStars": {
        "id": "claude",
        "kind": "provider",
      },
      "rows": [
        "codex · GPT-5",
        "claude · HAIKU",
      ],
    }
  `);
});

it('saves a pick at once: another model of the same provider, or another provider without raising access', () => {
  const [opus, haiku] = CLAUDE.info?.kind === 'ready' ? CLAUDE.info.models : [];
  const [gpt] = CODEX.info?.kind === 'ready' ? CODEX.info.models : [];
  if (opus === undefined || haiku === undefined || gpt === undefined) throw new Error('fixture');
  const full: BoundProvider = { ...BOUND, pluginId: 'codex', selection: { kind: 'default' }, access: 'full' };
  expect({
    sameModel: summary(pickedBinding(CLAUDE, opus, BOUND, true)),
    otherModel: summary(pickedBinding(CLAUDE, haiku, BOUND, true)),
    otherProviderModel: summary(pickedBinding(CODEX, gpt, BOUND, true)),
    otherProviderAuto: summary(pickedBinding(CODEX, null, BOUND, true)),
    fullStaysFullForOwner: summary(pickedBinding(CLAUDE, opus, full, true)),
    fullDropsForMember: summary(pickedBinding(CLAUDE, opus, full, false)),
  }).toMatchInlineSnapshot(`
    {
      "fullDropsForMember": "claude · opus {"effort":"high"} · read-only",
      "fullStaysFullForOwner": "claude · opus {"effort":"high"} · full",
      "otherModel": "claude · haiku {"effort":"high"} · workspace-write",
      "otherProviderAuto": "codex · gpt-5 {"effort":"high"} · workspace-write",
      "otherProviderModel": "codex · gpt-5 {"effort":"high"} · workspace-write",
      "sameModel": null,
    }
  `);
});
