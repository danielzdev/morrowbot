import { acp, type ProviderModel } from '@morrowbot/plugin-sdk';

export const MODEL = 'model';

/** The models opencode offers, learned from its sessions: opencode lists them only once a session is open. */
export interface ModelCatalog {
  /**
   * Learns from a session's settings. `fresh` is true for a session's settings before Ori Bot
   * changed anything, so its model is opencode's default. Returns the new list when it changed.
   */
  observe(options: readonly acp.ConfigOption[], fresh: boolean): readonly ProviderModel[] | null;
  /** The models seen so far, or null before any session. */
  models(): readonly ProviderModel[] | null;
}

export function createModelCatalog(): ModelCatalog {
  let listed: readonly { readonly value: string; readonly name: string }[] | null = null;
  let defaultModel: string | null = null;
  let current: readonly ProviderModel[] | null = null;
  return {
    observe: (options, fresh) => {
      const model = acp.selectOf(options, MODEL);
      if (model === null) return null;
      listed = model.values;
      if (fresh) defaultModel = model.current;
      const next = listed.map(({ value, name }): ProviderModel => ({ id: value, label: label(value, name), isDefault: value === defaultModel, options: [] }));
      if (JSON.stringify(next) === JSON.stringify(current)) return null;
      current = next;
      return next;
    },
    models: () => current,
  };
}

/** "Big Pickle" for opencode's "opencode/Big Pickle": the provider prefix it puts on every name is left out. */
function label(id: string, name: string): string {
  const provider = id.includes('/') ? `${id.slice(0, id.indexOf('/'))}/` : null;
  const shown = provider !== null && name.startsWith(provider) ? name.slice(provider.length) : name;
  return shown.trim() === '' ? id : shown;
}
