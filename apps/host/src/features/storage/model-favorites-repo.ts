import type { DatabaseSync } from 'node:sqlite';
import { ModelFavorite, type ModelFavoriteChange, type ModelFavorites } from '@morrowbot/contracts';
import { z } from 'zod';

const FavoriteRow = z
  .object({ plugin_id: z.string(), model_id: z.string() })
  .transform((row) => ({ pluginId: row.plugin_id, modelId: row.model_id }))
  .pipe(ModelFavorite);

/** The composer's starred models, kept by the host so every device sees the same stars. */
export interface ModelFavoritesRepository {
  list(): ModelFavorites;
  /** Stars or unstars one model; starring a starred model, or unstarring one that isn't, changes nothing. */
  change(change: ModelFavoriteChange): ModelFavorites;
}

export function modelFavoritesRepository(db: DatabaseSync): ModelFavoritesRepository {
  const all = db.prepare('SELECT plugin_id, model_id FROM model_favorites ORDER BY seq');
  const add = db.prepare('INSERT INTO model_favorites (plugin_id, model_id) VALUES (:pluginId, :modelId) ON CONFLICT (plugin_id, model_id) DO NOTHING');
  const remove = db.prepare('DELETE FROM model_favorites WHERE plugin_id = :pluginId AND model_id = :modelId');
  const list = (): ModelFavorites => ({ favorites: all.all().map((row) => FavoriteRow.parse(row)) });
  return {
    list,
    change: ({ pluginId, modelId, favorite }) => {
      (favorite ? add : remove).run({ pluginId, modelId });
      return list();
    },
  };
}
