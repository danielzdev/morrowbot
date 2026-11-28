/**
 * Migration 18 (thread cards). A card an agent puts in a chat with `propose_card` is saved as it is proposed, with no
 * message; once its turn's reply is saved it belongs to that reply (in the same transaction), and a turn that saves
 * no reply drops it. `body` is the card's JSON (`CardBody`), `revision` counts its changes; ordering is `seq`.
 */
export const MIGRATION_18 = `
  CREATE TABLE thread_cards (
    seq INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
    message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    body TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX thread_cards_by_thread ON thread_cards(thread_id, seq);
  CREATE INDEX thread_cards_open ON thread_cards(generation_id) WHERE message_id IS NULL;
`;
