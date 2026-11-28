import type { AccessLevel, BoundProvider, ModelSelection, ProviderInfo, ProviderModel, VendorSettings } from '@morrowbot/contracts';

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

/** A model option that sets reasoning effort (Claude's `effort`, Codex's `reasoningEffort`, Antigravity's `thought_level`). */
export const isEffortOption = (optionId: string): boolean => /effort|thought_level/i.test(optionId);

/**
 * The binding a sub-agent runs with: the parent's, changed only where the request says, and never with more
 * access than the parent has. `info` is the target provider's (undefined when it could not be read).
 */
export function targetBinding(parent: BoundProvider, request: SpawnRequest, info: ProviderInfo | undefined): Target {
  const access = request.access ?? parent.access;
  if (ACCESS_RANK[access] > ACCESS_RANK[parent.access]) {
    return { kind: 'refused', reason: `A sub-agent cannot have more access than you: you have ${parent.access}, it asked for ${access}.` };
  }
  const pluginId = request.provider ?? parent.pluginId;
  const vendorSettings = settingsFor(parent.vendorSettings, access, info);
  if (vendorSettings === undefined) {
    return {
      kind: 'refused',
      reason: `Provider ${pluginId} runs ${access} only with the user's personal setup, which can read more than your isolated setup: a sub-agent cannot have more access than you.`,
    };
  }
  const selection = selectionFor(parent, pluginId, request, info);
  if (selection.kind === 'refused') return selection;
  return { kind: 'ok', binding: { kind: 'bound', pluginId, selection: selection.selection, access, vendorSettings } };
}

/**
 * The parent's setup when the provider offers it for a background turn. A parent on the user's personal setup
 * may start an isolated sub-agent (it reads less), never the other way: undefined when that is all there is.
 * With nothing known about the provider, the parent's setup is kept and admission says what is offered.
 */
function settingsFor(parent: VendorSettings, access: AccessLevel, info: ProviderInfo | undefined): VendorSettings | undefined {
  if (info?.kind !== 'ready' && info?.kind !== 'ready-models-later') return parent;
  const offered = (settings: VendorSettings): boolean =>
    info.capabilities.profiles.some((profile) => profile.access === access && profile.vendorSettings === settings && profile.modes.includes('background'));
  if (offered(parent)) return parent;
  switch (parent) {
    case 'personal':
      return offered('isolated') ? 'isolated' : parent;
    case 'isolated':
      return offered('personal') ? undefined : parent;
  }
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
