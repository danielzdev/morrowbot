/**
 * Migration 5 (paired devices). Only a SHA-256 hash of each device token is kept; a revoked row stays as a record.
 */
export const MIGRATION_5 = `
  CREATE TABLE paired_devices (
    device_id TEXT PRIMARY KEY,
    device_name TEXT NOT NULL,
    platform TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    revoked_at TEXT
  ) STRICT;
`;
