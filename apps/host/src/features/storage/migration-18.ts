/**
 * Migration 18 (queued message attachments & archived chats).
 * - Adds `attachment_ids` (JSON array of attachment IDs in send order) on `queued_messages` so messages queued
 *   while a reply runs can carry uploaded files.
 * - Adds `archived_at` on `threads` plus an agent/archive index so chats can be archived out of default tabs
 *   and lists without deleting them.
 */
export const MIGRATION_18 = `
  ALTER TABLE queued_messages ADD COLUMN attachment_ids TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE threads ADD COLUMN archived_at TEXT;
  CREATE INDEX threads_by_agent_archived ON threads(agent_id, archived_at, created_at);
`;
