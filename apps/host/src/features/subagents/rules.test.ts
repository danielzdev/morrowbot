import type { BoundProvider, ProviderInfo, ProviderModel } from '@morrowbot/contracts';
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

const ready = (models: ProviderModel[]): ProviderInfo => ({
  kind: 'ready',
  version: '1',
  accountKey: '',
  accountLabel: null,
  warning: null,
  models,
  capabilities: { profiles: [], approvals: false, sessions: false, usage: 'none', withheld: [] },
});

/** Two providers as their CLIs report them: Claude's `effort` option, Codex's `reasoningEffort`. */
const INFO: Readonly<Record<string, ProviderInfo>> = {
  claude: ready([
    { id: 'opus', label: 'Opus', isDefault: false, options: [efforts('effort', 'low', 'high', 'max')] },
    { id: 'sonnet', label: 'Sonnet', isDefault: true, options: [efforts('effort', 'low', 'high')] },
  ]),
  codex: ready([{ id: 'gpt-5.5', label: 'GPT-5.5', isDefault: true, options: [efforts('reasoningEffort', 'low', 'medium', 'xhigh')] }]),
};

const ask = (request: Partial<SpawnRequest>) => {
  const full: SpawnRequest = { role: 'r', prompt: 'p', provider: undefined, model: undefined, effort: undefined, access: undefined, ...request };
  const target = targetBinding(PARENT, full, INFO[full.provider ?? PARENT.pluginId]);
  return target.kind === 'ok' ? { access: target.binding.access, pluginId: target.binding.pluginId, selection: target.binding.selection } : target.reason;
};

it('inherits the parent binding, and changes only the model, effort, provider or access asked for', () => {
  expect({
    nothingAsked: ask({}),
    lowerEffort: ask({ effort: 'low' }),
    otherModel: ask({ model: 'sonnet' }),
    codexDefaultModel: ask({ provider: 'codex' }),
    codexWithEffort: ask({ provider: 'codex', effort: 'xhigh' }),
    readOnly: ask({ access: 'read-only' }),
  }).toMatchInlineSnapshot(`
    {
      "codexDefaultModel": {
        "access": "workspace-write",
        "pluginId": "codex",
        "selection": {
          "kind": "default",
        },
      },
      "codexWithEffort": {
        "access": "workspace-write",
        "pluginId": "codex",
        "selection": {
          "choices": {
            "reasoningEffort": "xhigh",
          },
          "id": "gpt-5.5",
          "kind": "model",
        },
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
      },
      "otherModel": {
        "access": "workspace-write",
        "pluginId": "claude",
        "selection": {
          "choices": {},
          "id": "sonnet",
          "kind": "model",
        },
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
      },
    }
  `);
});

it('refuses more access than the parent, and efforts or models the provider does not list', () => {
  expect({
    escalation: ask({ access: 'full' }),
    unknownEffort: ask({ provider: 'codex', effort: 'max' }),
    unknownModel: ask({ model: 'haiku-9' }),
  }).toMatchInlineSnapshot(`
    {
      "escalation": "A sub-agent cannot have more access than you: you have workspace-write, it asked for full.",
      "unknownEffort": "Model gpt-5.5 takes effort low, medium, xhigh.",
      "unknownModel": "Provider claude has no model haiku-9. Its models: opus, sonnet.",
    }
  `);
});
