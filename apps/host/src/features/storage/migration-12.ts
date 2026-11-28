/**
 * Migration 12 (server members). A member is created with its invite and holds no token until the invite is
 * claimed; a scoped member's grants name the agents it may use. Deleting an agent removes its grants.
 */
export const MIGRATION_12 = `
  CREATE TABLE members (
    member_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('co-owner', 'scoped')),
    token_hash TEXT UNIQUE,
    device_name TEXT,
    platform TEXT,
    created_at TEXT NOT NULL,
    joined_at TEXT,
    last_seen_at TEXT,
    revoked_at TEXT,
    CHECK ((token_hash IS NULL) = (joined_at IS NULL)),
    CHECK ((token_hash IS NULL) = (device_name IS NULL)),
    CHECK ((token_hash IS NULL) = (platform IS NULL)),
    CHECK ((token_hash IS NULL) = (last_seen_at IS NULL))
  ) STRICT;

  CREATE TABLE member_invites (
    code_hash TEXT PRIMARY KEY,
    member_id TEXT NOT NULL REFERENCES members(member_id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    claimed_at TEXT
  ) STRICT;
  CREATE INDEX member_invites_by_member ON member_invites(member_id);

  CREATE TABLE member_agent_grants (
    member_id TEXT NOT NULL REFERENCES members(member_id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    can_edit INTEGER NOT NULL CHECK (can_edit IN (0, 1)),
    workspace TEXT NOT NULL CHECK (workspace IN ('read-only', 'workspace-write')),
    inter_agent_allowlist TEXT NOT NULL,
    PRIMARY KEY (member_id, agent_id)
  ) STRICT;
  CREATE INDEX member_agent_grants_by_agent ON member_agent_grants(agent_id);
`;
