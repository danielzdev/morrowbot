import { z } from 'zod';

/** One starred model of the composer's model picker: a provider's model, by ids. */
export const ModelFavorite = z.strictObject({ pluginId: z.string().min(1).max(200), modelId: z.string().min(1).max(200) });
export type ModelFavorite = z.infer<typeof ModelFavorite>;

/** The host's starred models, oldest first, shared by every window and device. */
export const ModelFavorites = z.strictObject({ favorites: z.array(ModelFavorite).max(500) });
export type ModelFavorites = z.infer<typeof ModelFavorites>;

/** Stars or unstars one model; the host answers with the whole list after the change. */
export const ModelFavoriteChange = z.strictObject({ pluginId: ModelFavorite.shape.pluginId, modelId: ModelFavorite.shape.modelId, favorite: z.boolean() });
export type ModelFavoriteChange = z.infer<typeof ModelFavoriteChange>;
