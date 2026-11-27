/**
 * Migration 6 (agent-to-agent messages). A message goes when the chat on either end goes, and a reply goes
 * with the message it answers. A message has at most one reply.
 */
export const MIGRATION_6 = `
  CREATE TABLE agent_messages (
    id TEXT PRIMARY KEY,
    from_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    from_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    to_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    to_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    expects_reply INTEGER NOT NULL CHECK (expects_reply IN (0, 1)),
    reply_to_message_id TEXT UNIQUE REFERENCES agent_messages(id) ON DELETE CASCADE,
    depth INTEGER NOT NULL CHECK (depth >= 0),
    created_at TEXT NOT NULL,
    CHECK (from_agent_id <> to_agent_id)
  ) STRICT;
  CREATE INDEX agent_messages_from ON agent_messages(from_agent_id, created_at);
  CREATE INDEX agent_messages_to ON agent_messages(to_agent_id, created_at);
  CREATE INDEX agent_messages_from_thread ON agent_messages(from_thread_id);
  CREATE INDEX agent_messages_to_thread ON agent_messages(to_thread_id);
`;
