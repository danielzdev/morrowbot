/**
 * Migration 2 (provider wire contract v1). Append-only: never edit a migration that has shipped.
 * - Agent bindings `bound{pluginId, model}` become `bound{pluginId, selection, access, vendorSettings}`,
 *   read-only and isolated. Claude's selection comes from its saved `model` plugin setting, which is then removed.
 * - Message outcomes move to the v1 shapes (`stopped` → `cancelled`, failure text → `other`).
 * - New tables for generations, provider sessions, child process groups, continuations and usage.
 */
const SELECTED = `CASE
  WHEN json_extract(provider, '$.pluginId') = 'provider-claude'
    THEN COALESCE((SELECT json_extract(config, '$.model') FROM plugin_configs WHERE plugin_id = 'provider-claude'), 'default')
  ELSE json_extract(provider, '$.model')
END`;

export const MIGRATION_2 = `
  UPDATE agents SET provider = json_object(
    'kind', 'bound',
    'pluginId', json_extract(provider, '$.pluginId'),
    'selection', json(CASE WHEN ${SELECTED} = 'default'
      THEN json_object('kind', 'default')
      ELSE json_object('kind', 'model', 'id', ${SELECTED}, 'choices', json_object())
    END),
    'access', 'read-only',
    'vendorSettings', 'isolated'
  )
  WHERE json_extract(provider, '$.kind') = 'bound';
  UPDATE plugin_configs SET config = json_remove(config, '$.model') WHERE plugin_id = 'provider-claude';

  UPDATE messages SET outcome = CASE json_extract(outcome, '$.kind')
    WHEN 'completed' THEN json_object('kind', 'completed', 'finishReason', 'stop')
    WHEN 'stopped' THEN json_object('kind', 'cancelled')
    WHEN 'failed' THEN json_object('kind', 'failed', 'error',
      json_object('kind', 'other', 'message', json_extract(outcome, '$.error')))
    ELSE outcome
  END
  WHERE kind = 'assistant';
  ALTER TABLE messages ADD COLUMN seed_truncated INTEGER NOT NULL DEFAULT 0 CHECK (seed_truncated IN (0, 1));

  CREATE TABLE provider_sessions (
    id INTEGER PRIMARY KEY,
    plugin_id TEXT NOT NULL,
    account_key TEXT NOT NULL DEFAULT '',
    route_key TEXT NOT NULL DEFAULT '',
    cwd TEXT NOT NULL,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    ref TEXT NOT NULL,
    system_hash TEXT NOT NULL,
    vendor_settings TEXT NOT NULL CHECK (vendor_settings IN ('isolated', 'personal')),
    state TEXT NOT NULL DEFAULT 'clean' CHECK (state IN ('clean', 'diverged', 'needs-seed')),
    UNIQUE (plugin_id, account_key, route_key, cwd, thread_id)
  ) STRICT;
  CREATE INDEX provider_sessions_by_thread ON provider_sessions(thread_id);

  CREATE TABLE child_groups (
    pgid INTEGER PRIMARY KEY,
    reg_id TEXT NOT NULL UNIQUE,
    plugin_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('turn', 'daemon', 'probe')),
    boot_id TEXT,
    leader_start TEXT NOT NULL,
    started_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE child_group_generations (
    pgid INTEGER NOT NULL REFERENCES child_groups(pgid) ON DELETE CASCADE,
    generation_id TEXT NOT NULL,
    PRIMARY KEY (pgid, generation_id)
  ) STRICT;

  CREATE TABLE generations (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    plugin_id TEXT NOT NULL,
    account_key TEXT NOT NULL,
    input_message_id TEXT NOT NULL,
    partial_text TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,
    dispatched_at TEXT,
    settled INTEGER NOT NULL DEFAULT 0 CHECK (settled IN (0, 1)),
    attempted_session_row INTEGER,
    prior_state TEXT CHECK (prior_state IN ('clean', 'diverged', 'needs-seed')),
    result_message_id TEXT UNIQUE
  ) STRICT;
  CREATE INDEX generations_by_thread ON generations(thread_id);

  CREATE TABLE continuations (
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    failed_message_id TEXT NOT NULL,
    generation_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (thread_id, failed_message_id)
  ) STRICT;

  CREATE TABLE turn_usage (
    generation_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    plugin_id TEXT NOT NULL,
    account_key TEXT NOT NULL,
    actual_model TEXT,
    input_tokens INTEGER,
    cached_input_tokens INTEGER,
    cache_write_tokens INTEGER,
    output_tokens INTEGER,
    reasoning_tokens INTEGER,
    outcome TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE usage_snapshots (
    plugin_id TEXT NOT NULL,
    account_key TEXT NOT NULL DEFAULT '',
    window_id TEXT NOT NULL,
    window TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    PRIMARY KEY (plugin_id, account_key, window_id)
  ) STRICT;
`;
