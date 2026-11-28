import type { AccessProfile, BoundProvider, ProviderInfo, ProviderModel } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { targetBinding, type SpawnRequest } from './rules.ts';

const PARENT: BoundProvider = {
  kind: 'bound',
  pluginId: 'claude',
  selection: { kind: 'model', id: 'opus', choices: { effort: 'high' } },
  access: 'workspace-write',
  vendorSettings: 'isolated',
};

const efforts = (id: string, ...choices: string[]) => ({ id, label: 'Effort', defaultChoiceId: choices[0] ?? '', choices: choices.map((choice) => ({ id: choice, label: choice })) });

const profile = (access: AccessProfile['access'], vendorSettings: AccessProfile['vendorSettings']): AccessProfile => ({
  access,
  vendorSettings,
  modes: ['interactive', 'background'],
  readsOutsideCwd: vendorSettings === 'personal',
});

const ready = (models: ProviderModel[], profiles: AccessProfile[]): ProviderInfo => ({
  kind: 'ready',
  version: '1',
  accountKey: '',
  accountLabel: null,
  warning: null,
  models,
  capabilities: { profiles, approvals: false, sessions: false, usage: 'none', withheld: [] },
});

/**
 * Two providers as their CLIs report them on macOS: Claude's `effort` option and isolated profiles, Codex's
 * `reasoningEffort` and its one read-only profile, on the user's personal setup.
 */
const INFO: Readonly<Record<string, ProviderInfo>> = {
  claude: ready([
    { id: 'opus', label: 'Opus', isDefault: false, options: [efforts('effort', 'low', 'high', 'max')] },
    { id: 'sonnet', label: 'Sonnet', isDefault: true, options: [efforts('effort', 'low', 'high')] },
  ], [profile('read-only', 'isolated'), profile('workspace-write', 'isolated')]),
  codex: ready([{ id: 'gpt-5.5', label: 'GPT-5.5', isDefault: true, options: [efforts('reasoningEffort', 'low', 'medium', 'xhigh')] }], [profile('read-only', 'personal')]),
  antigravity: ready([{ id: 'gemini-4-neon', label: 'Gemini 4 Neon', isDefault: true, options: [efforts('thought_level', 'low', 'high', 'xhigh')] }], [profile('read-only', 'personal')]),
};

const askAs = (parent: BoundProvider, request: Partial<SpawnRequest>) => {
  const full: SpawnRequest = { role: 'r', prompt: 'p', provider: undefined, model: undefined, effort: undefined, access: undefined, ...request };
  const target = targetBinding(parent, full, INFO[full.provider ?? parent.pluginId]);
  if (target.kind === 'refused') return target.reason;
  const { access, pluginId, selection, vendorSettings } = target.binding;
  return { access, vendorSettings, pluginId, selection };
};
const ask = (request: Partial<SpawnRequest>) => askAs(PARENT, request);

const CODEX_PARENT: BoundProvider = { kind: 'bound', pluginId: 'codex', selection: { kind: 'default' }, access: 'read-only', vendorSettings: 'personal' };

it("sets Antigravity's thinking level as a sub-agent's effort", () => {
  expect(askAs(CODEX_PARENT, { provider: 'antigravity', model: 'gemini-4-neon', effort: 'xhigh' })).toMatchInlineSnapshot(`
    {
      "access": "read-only",
      "pluginId": "antigravity",
      "selection": {
        "choices": {
          "thought_level": "xhigh",
        },
        "id": "gemini-4-neon",
        "kind": "model",
      },
      "vendorSettings": "personal",
    }
  `);
});

it('inherits the parent binding, and changes only the model, effort, provider or access asked for', () => {
  expect({
    nothingAsked: ask({}),
    lowerEffort: ask({ effort: 'low' }),
    otherModel: ask({ model: 'sonnet' }),
    readOnly: ask({ access: 'read-only' }),
    claudeFromPersonalCodex: askAs(CODEX_PARENT, { provider: 'claude' }),
    codexWithEffort: askAs(CODEX_PARENT, { effort: 'xhigh' }),
  }).toMatchInlineSnapshot(`
    {
      "claudeFromPersonalCodex": {
        "access": "read-only",
        "pluginId": "claude",
        "selection": {
          "kind": "default",
        },
        "vendorSettings": "isolated",
      },
      "codexWithEffort": {
        "access": "read-only",
        "pluginId": "codex",
        "selection": {
          "choices": {
            "reasoningEffort": "xhigh",
          },
          "id": "gpt-5.5",
          "kind": "model",
        },
        "vendorSettings": "personal",
      },
      "lowerEffort": {
        "access": "workspace-write",
        "pluginId": "claude",
        "selection": {
          "choices": {
            "effort": "low",
          },
          "id": "opus",
          "kind": "model",
        },
        "vendorSettings": "isolated",
      },
      "nothingAsked": {
        "access": "workspace-write",
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
      "otherModel": {
        "access": "workspace-write",
        "pluginId": "claude",
        "selection": {
          "choices": {},
          "id": "sonnet",
          "kind": "model",
        },
        "vendorSettings": "isolated",
      },
      "readOnly": {
        "access": "read-only",
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
    }
  `);
});

it('refuses more access than the parent, and efforts or models the provider does not list', () => {
  expect({
    escalation: ask({ access: 'full' }),
    personalFromIsolated: ask({ provider: 'codex', access: 'read-only' }),
    unknownEffort: askAs(CODEX_PARENT, { effort: 'max' }),
    unknownModel: ask({ model: 'haiku-9' }),
  }).toMatchInlineSnapshot(`
    {
      "escalation": "A sub-agent cannot have more access than you: you have workspace-write, it asked for full.",
      "personalFromIsolated": "Provider codex runs read-only only with the user's personal setup, which can read more than your isolated setup: a sub-agent cannot have more access than you.",
      "unknownEffort": "Model gpt-5.5 takes effort low, medium, xhigh.",
      "unknownModel": "Provider claude has no model haiku-9. Its models: opus, sonnet.",
    }
  `);
});
