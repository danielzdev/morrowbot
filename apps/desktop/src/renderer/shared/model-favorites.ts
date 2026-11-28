import type { ModelFavorite } from '@morrowbot/contracts';
import type { Api } from './api.ts';
import { Store } from './store.ts';

/** The composer's starred models, kept by the host so every window and device sees the same list. */
export interface ModelFavoritesModel {
  /** Oldest star first; empty until the host answers. */
  readonly state: Store<readonly ModelFavorite[]>;
  /** Fetches the list again, such as when the model picker opens. */
  load(): Promise<void>;
  /** Stars or unstars one model at once, then adopts the host's list (or fetches it again when the change failed). */
  toggle(pluginId: string, modelId: string): Promise<void>;
}

export const isFavorite = (favorites: readonly ModelFavorite[], pluginId: string, modelId: string): boolean =>
  favorites.some((each) => each.pluginId === pluginId && each.modelId === modelId);

export function createModelFavorites(api: Pick<Api, 'modelFavorites' | 'changeModelFavorite'>): ModelFavoritesModel {
  const state = new Store<readonly ModelFavorite[]>([]);
  let version = 0;
  const load = async (): Promise<void> => {
    const mine = ++version;
    const result = await api.modelFavorites();
    if (mine === version && result.kind === 'ok') state.set(result.value.favorites);
  };
  return {
    state,
    load,
    toggle: async (pluginId, modelId) => {
      const favorite = !isFavorite(state.get(), pluginId, modelId);
      const others = state.get().filter((each) => each.pluginId !== pluginId || each.modelId !== modelId);
      state.set(favorite ? [...others, { pluginId, modelId }] : others);
      const mine = ++version;
      const result = await api.changeModelFavorite({ pluginId, modelId, favorite });
      if (result.kind === 'ok') {
        if (mine === version) state.set(result.value.favorites);
      } else await load();
    },
  };
}
