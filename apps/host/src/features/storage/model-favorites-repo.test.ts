import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { openStorage } from './index.ts';

it('keeps starred models in the order they were starred, once each, and survives a reopen', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'oribot-favorites-'));
  const file = path.join(dir, 'oribot.sqlite');
  try {
    const storage = openStorage(file, () => '2026-01-01T00:00:00.000Z');
    const { modelFavorites } = storage;
    modelFavorites.change({ pluginId: 'provider-claude', modelId: 'opus', favorite: true });
    modelFavorites.change({ pluginId: 'provider-openai', modelId: 'gpt-5', favorite: true });
    modelFavorites.change({ pluginId: 'provider-claude', modelId: 'opus', favorite: true });
    modelFavorites.change({ pluginId: 'provider-claude', modelId: 'haiku', favorite: true });
    const afterRemove = modelFavorites.change({ pluginId: 'provider-openai', modelId: 'gpt-5', favorite: false });
    const removeMissing = modelFavorites.change({ pluginId: 'provider-openai', modelId: 'gpt-5', favorite: false });
    storage.close();
    const reopened = openStorage(file, () => '2026-01-01T00:00:00.000Z');
    const afterReopen = reopened.modelFavorites.list();
    reopened.close();
    expect({ afterRemove, removeMissing, afterReopen }).toMatchInlineSnapshot(`
      {
        "afterRemove": {
          "favorites": [
            {
              "modelId": "opus",
              "pluginId": "provider-claude",
            },
            {
              "modelId": "haiku",
              "pluginId": "provider-claude",
            },
          ],
        },
        "afterReopen": {
          "favorites": [
            {
              "modelId": "opus",
              "pluginId": "provider-claude",
            },
            {
              "modelId": "haiku",
              "pluginId": "provider-claude",
            },
          ],
        },
        "removeMissing": {
          "favorites": [
            {
              "modelId": "opus",
              "pluginId": "provider-claude",
            },
            {
              "modelId": "haiku",
              "pluginId": "provider-claude",
            },
          ],
        },
      }
    `);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
