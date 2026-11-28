import { acp, type ModelOption, type ProviderModel } from '@morrowbot/plugin-sdk';

export const MODEL = 'model';
export const THOUGHT = 'thought_level';

/**
 * The models agy offers, learned from its sessions: agy lists them only once a session is open.
 * Each model's thinking levels are known once a session has run on it.
 */
export interface ModelCatalog {
  /**
   * Learns from a session's settings. `fresh` is true for a session's settings before Ori Bot
   * changed anything, so its model is agy's default. Returns the new list when it changed.
   */
  observe(options: readonly acp.ConfigOption[], fresh: boolean): readonly ProviderModel[] | null;
  /** The models seen so far, or null before any session. */
  models(): readonly ProviderModel[] | null;
}

export function createModelCatalog(): ModelCatalog {
  let listed: readonly { readonly value: string; readonly name: string }[] | null = null;
  let defaultModel: string | null = null;
  const thinking = new Map<string, ModelOption>();
  let current: readonly ProviderModel[] | null = null;

  const build = (): readonly ProviderModel[] | null => {
    if (listed === null) return null;
    return listed.map(({ value, name }): ProviderModel => {
      const levels = thinking.get(value);
      return { id: value, label: name.trim() === '' ? value : name, isDefault: value === defaultModel, options: levels === undefined ? [] : [levels] };
    });
  };

  return {
    observe: (options, fresh) => {
      const model = acp.selectOf(options, MODEL);
      if (model === null) return null;
      listed = model.values;
      if (fresh) defaultModel = model.current;
      const levels = thoughtOption(options);
      if (levels === null) thinking.delete(model.current);
      else thinking.set(model.current, levels);
      const next = build();
      if (next === null || JSON.stringify(next) === JSON.stringify(current)) return null;
      current = next;
      return next;
    },
    models: () => current,
  };
}

/** The `thought_level` setting as a picker option, or null when the model has none. */
function thoughtOption(options: readonly acp.ConfigOption[]): ModelOption | null {
  const thought = acp.selectOf(options, THOUGHT);
  const label = options.find((option) => option.id === THOUGHT)?.name ?? 'Thinking';
  if (thought === null || thought.values.length === 0) return null;
  const choices = thought.values.map(({ value, name }) => ({ id: value, label: name.trim() === '' ? value : name }));
  const defaultChoiceId = choices.some((choice) => choice.id === thought.current) ? thought.current : (choices[0]?.id ?? thought.current);
  return { id: THOUGHT, label: label.trim() === '' ? 'Thinking' : label, defaultChoiceId, choices };
}
