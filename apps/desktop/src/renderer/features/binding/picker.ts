import type { ModelFavorite, ProviderModel } from '@morrowbot/contracts';
import { isRunnable, pinModel, readyInfo, switchBinding, type ProviderChoice } from '../../shared/binding-ui/selection.ts';
import type { BoundProvider } from './binding-display.ts';

/** What the picker's middle column lists: the starred models of every provider, or one provider's models. */
export type PickerTab = { readonly kind: 'favorites' } | { readonly kind: 'provider'; readonly id: string };

/** A starred model the picker can offer now: its provider is runnable and still lists it. */
export interface FavoriteRow {
  readonly choice: ProviderChoice;
  readonly model: ProviderModel;
}

/** The starred models that can be picked now, oldest star first; the others wait until their provider lists them again. */
export function favoriteRows(choices: readonly ProviderChoice[], favorites: readonly ModelFavorite[]): readonly FavoriteRow[] {
  return favorites.flatMap(({ pluginId, modelId }) => {
    const choice = choices.find(({ id }) => id === pluginId);
    const info = readyInfo(choice?.info);
    const model = info?.kind === 'ready' ? info.models.find(({ id }) => id === modelId) : undefined;
    return choice !== undefined && model !== undefined && isRunnable(choice) ? [{ choice, model }] : [];
  });
}

/** Opens on Favorites when one can be picked, else on the agent's own provider (T3 Code's rule). */
export function openingTab(rows: readonly FavoriteRow[], binding: BoundProvider): PickerTab {
  return rows.length > 0 ? { kind: 'favorites' } : { kind: 'provider', id: binding.pluginId };
}

/**
 * The binding a pick saves at once: a model of the agent's provider, or (with `model` null, Auto) another
 * provider, switched without asking and without raising access. Null when nothing changes or it can't run.
 */
export function pickedBinding(choice: ProviderChoice, model: ProviderModel | null, binding: BoundProvider, allowFull: boolean): BoundProvider | null {
  if (choice.id === binding.pluginId) {
    if (model === null || (binding.selection.kind === 'model' && binding.selection.id === model.id)) return null;
    return { ...binding, selection: pinModel(model) };
  }
  const fresh = switchBinding(choice, binding, { allowFull });
  if (fresh.kind !== 'bound') return null;
  return model === null ? fresh : { ...fresh, selection: pinModel(model) };
}
