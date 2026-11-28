import type { AccessLevel, BoundProvider, ModelSelection, ProviderInfo, ProviderModel } from '@morrowbot/contracts';

/** What a turn asks a sub-agent to be. Left out, the provider, model and access are the parent's. */
export interface SpawnRequest {
  readonly role: string;
  readonly prompt: string;
  readonly provider: string | undefined;
  readonly model: string | undefined;
  readonly effort: string | undefined;
  readonly access: AccessLevel | undefined;
}

export type Target = { readonly kind: 'ok'; readonly binding: BoundProvider } | { readonly kind: 'refused'; readonly reason: string };

const ACCESS_RANK: Readonly<Record<AccessLevel, number>> = { 'read-only': 0, 'workspace-write': 1, full: 2 };

/** A model option that sets reasoning effort (Claude's `effort`, Codex's `reasoningEffort`). */
export const isEffortOption = (optionId: string): boolean => /effort/i.test(optionId);

/**
 * The binding a sub-agent runs with: the parent's, changed only where the request says, and never with more
 * access than the parent has. `info` is the target provider's, needed when a model or effort is named.
 */
export function targetBinding(parent: BoundProvider, request: SpawnRequest, info: ProviderInfo | undefined): Target {
  const access = request.access ?? parent.access;
  if (ACCESS_RANK[access] > ACCESS_RANK[parent.access]) {
    return { kind: 'refused', reason: `A sub-agent cannot have more access than you: you have ${parent.access}, it asked for ${access}.` };
  }
  const pluginId = request.provider ?? parent.pluginId;
  const selection = selectionFor(parent, pluginId, request, info);
  if (selection.kind === 'refused') return selection;
  return { kind: 'ok', binding: { kind: 'bound', pluginId, selection: selection.selection, access, vendorSettings: parent.vendorSettings } };
}

type Selected = { readonly kind: 'ok'; readonly selection: ModelSelection } | { readonly kind: 'refused'; readonly reason: string };

function selectionFor(parent: BoundProvider, pluginId: string, request: SpawnRequest, info: ProviderInfo | undefined): Selected {
  const samePlugin = pluginId === parent.pluginId;
  if (request.model === undefined && request.effort === undefined) {
    return { kind: 'ok', selection: samePlugin ? parent.selection : { kind: 'default' } };
  }
  if (info?.kind !== 'ready') return { kind: 'refused', reason: `Provider ${pluginId} has not listed its models yet, so leave out model and effort.` };
  const inherited = samePlugin && parent.selection.kind === 'model' ? parent.selection : undefined;
  const modelId = request.model ?? inherited?.id ?? info.models.find((model) => model.isDefault)?.id ?? info.models[0]?.id;
  const model = info.models.find(({ id }) => id === modelId);
  if (model === undefined) {
    return { kind: 'refused', reason: `Provider ${pluginId} has no model ${modelId ?? '(none)'}. Its models: ${info.models.map(({ id }) => id).join(', ')}.` };
  }
  const choices = inherited?.id === model.id ? { ...inherited.choices } : {};
  if (request.effort !== undefined) {
    const option = model.options.find(({ id }) => isEffortOption(id));
    if (option === undefined) return { kind: 'refused', reason: `Model ${model.id} of ${pluginId} has no effort setting: leave out effort.` };
    if (!option.choices.some(({ id }) => id === request.effort)) {
      return { kind: 'refused', reason: `Model ${model.id} takes effort ${option.choices.map(({ id }) => id).join(', ')}.` };
    }
    choices[option.id] = request.effort;
  }
  return { kind: 'ok', selection: { kind: 'model', id: model.id, choices } };
}

/** A ready provider's models as `list_subagents` shows them to a turn choosing where to spawn. */
export function modelsShown(models: readonly ProviderModel[]): object[] {
  return models.map((model) => ({
    id: model.id,
    label: model.label,
    isDefault: model.isDefault,
    efforts: model.options.find(({ id }) => isEffortOption(id))?.choices.map(({ id }) => id) ?? [],
  }));
}
