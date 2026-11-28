/**
 * Migration 15 (reactions and silent replies). Each actor puts a given emoji on a message at most once; deleting
 * the message removes its reactions. Agents get their own emoji-only setting, and the host one row of chat settings.
 */
export const MIGRATION_15 = `
  CREATE TABLE message_reactions (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    actor TEXT NOT NULL CHECK (actor IN ('user', 'agent')),
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (message_id, actor, emoji)
  ) STRICT;

  ALTER TABLE agents ADD COLUMN emoji_replies TEXT NOT NULL DEFAULT 'allowed' CHECK (emoji_replies IN ('allowed', 'off'));

  CREATE TABLE chat_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    emoji_replies TEXT NOT NULL CHECK (emoji_replies IN ('per_agent', 'all', 'off'))
  ) STRICT;
  INSERT INTO chat_settings (id, emoji_replies) VALUES (1, 'per_agent');
`;
