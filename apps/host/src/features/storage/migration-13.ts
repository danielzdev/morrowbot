/**
 * Migration 13 (connectors). One row per connector instance: its privacy-safe label (unique by its tool-name key),
 * its setup with write-only secrets, the user's on/off and connect choices, and its scope record. A Selected
 * scope's agents live in `connector_scope_agents`; deleting an agent removes it there and bumps the revision,
 * so a window holding the old scope gets a conflict instead of writing it back.
 */
export const MIGRATION_13 = `
  CREATE TABLE connectors (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    label_key TEXT NOT NULL UNIQUE,
    setup TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    connected INTEGER NOT NULL CHECK (connected IN (0, 1)),
    scope_mode TEXT NOT NULL CHECK (scope_mode IN ('all', 'selected')),
    scope_revision INTEGER NOT NULL CHECK (scope_revision >= 0),
    scope_review_required INTEGER NOT NULL CHECK (scope_review_required IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE connector_scope_agents (
    connector_id TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (connector_id, agent_id)
  ) STRICT;
  CREATE INDEX connector_scope_agents_by_agent ON connector_scope_agents(agent_id);

  CREATE TRIGGER connector_scope_agent_removed AFTER DELETE ON connector_scope_agents
  BEGIN
    UPDATE connectors SET scope_revision = scope_revision + 1 WHERE id = OLD.connector_id;
  END;
`;
