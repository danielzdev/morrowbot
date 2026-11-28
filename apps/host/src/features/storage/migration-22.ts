/** Migration 22 (model favorites). The composer's starred models, one row each, kept in the order they were starred. */
export const MIGRATION_22 = `
  CREATE TABLE model_favorites (
    seq INTEGER PRIMARY KEY,
    plugin_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    UNIQUE (plugin_id, model_id)
  ) STRICT;
`;
