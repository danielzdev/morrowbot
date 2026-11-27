import type { DatabaseSync } from 'node:sqlite';
import type { TurnOutcome, TurnUsage } from '@morrowbot/contracts';
import { z } from 'zod';

export const SessionState = z.enum(['clean', 'diverged', 'needs-seed']);
export type SessionState = z.infer<typeof SessionState>;

/** One requested turn: written at admission, before anything reaches a plugin. */
export interface GenerationRecord {
  readonly id: string;
  readonly threadId: string;
  readonly pluginId: string;
  readonly accountKey: string;
  /** The user message this turn answers (its source input). */
  readonly inputMessageId: string;
  readonly startedAt: string;
  /** The provider session row the turn will use, and that row's state before the turn. */
  readonly attemptedSessionRow: number | null;
  readonly priorState: SessionState | null;
}

const GenerationRow = z
  .object({
    id: z.string(),
    thread_id: z.string(),
    plugin_id: z.string(),
    account_key: z.string(),
    input_message_id: z.string(),
    partial_text: z.string(),
    started_at: z.string(),
    dispatched_at: z.string().nullable(),
    attempted_session_row: z.number().int().nullable(),
    prior_state: SessionState.nullable(),
  })
  .transform((row) => ({
    id: row.id,
    threadId: row.thread_id,
    pluginId: row.plugin_id,
    accountKey: row.account_key,
    inputMessageId: row.input_message_id,
    partialText: row.partial_text,
    startedAt: row.started_at,
    dispatched: row.dispatched_at !== null,
    attemptedSessionRow: row.attempted_session_row,
    priorState: row.prior_state,
  }));
export type UnsettledGeneration = z.output<typeof GenerationRow>;

export interface TurnUsageRecord {
  readonly generationId: string;
  readonly agentId: string;
  readonly threadId: string;
  readonly pluginId: string;
  readonly accountKey: string;
  readonly actualModel: string | null;
  readonly usage: TurnUsage;
  readonly outcome: TurnOutcome;
  readonly createdAt: string;
}

export interface GenerationRepository {
  insert(record: GenerationRecord): void;
  markDispatched(id: string, at: string): void;
  setAttemptedSessionRow(id: string, row: number): void;
  flushPartial(id: string, text: string): void;
  settle(id: string, resultMessageId: string): void;
  /** Generations a crash left unsettled, oldest first. */
  unsettled(): UnsettledGeneration[];
  /** The generation whose reply is `messageId`, for Continue. Migrated messages have none. */
  byResultMessage(messageId: string): { readonly id: string; readonly inputMessageId: string } | undefined;
  idsByThread(threadId: string): Set<string>;
  continuation(threadId: string, failedMessageId: string): string | undefined;
  insertContinuation(threadId: string, failedMessageId: string, generationId: string, at: string): void;
  insertUsage(record: TurnUsageRecord): void;
}

export function generationRepository(db: DatabaseSync): GenerationRepository {
  const insert = db.prepare(
    `INSERT INTO generations (id, thread_id, plugin_id, account_key, input_message_id, started_at, attempted_session_row, prior_state)
     VALUES (:id, :threadId, :pluginId, :accountKey, :inputMessageId, :startedAt, :attemptedSessionRow, :priorState)`,
  );
  const dispatched = db.prepare('UPDATE generations SET dispatched_at = ? WHERE id = ?');
  const attempted = db.prepare('UPDATE generations SET attempted_session_row = ? WHERE id = ?');
  const partial = db.prepare('UPDATE generations SET partial_text = ? WHERE id = ? AND settled = 0');
  const settle = db.prepare('UPDATE generations SET settled = 1, result_message_id = ? WHERE id = ?');
  const unsettled = db.prepare('SELECT * FROM generations WHERE settled = 0 ORDER BY started_at, rowid');
  const byResult = db.prepare('SELECT id, input_message_id FROM generations WHERE result_message_id = ?');
  const idsByThread = db.prepare('SELECT id FROM generations WHERE thread_id = ?');
  const continuation = db.prepare('SELECT generation_id FROM continuations WHERE thread_id = ? AND failed_message_id = ?');
  const insertContinuation = db.prepare(
    'INSERT INTO continuations (thread_id, failed_message_id, generation_id, created_at) VALUES (?, ?, ?, ?)',
  );
  const insertUsage = db.prepare(
    `INSERT INTO turn_usage (generation_id, agent_id, thread_id, plugin_id, account_key, actual_model, input_tokens,
       cached_input_tokens, cache_write_tokens, output_tokens, reasoning_tokens, outcome, created_at)
     VALUES (:generationId, :agentId, :threadId, :pluginId, :accountKey, :actualModel, :inputTokens,
       :cachedInputTokens, :cacheWriteTokens, :outputTokens, :reasoningTokens, :outcome, :createdAt)`,
  );
  return {
    insert: (record) => {
      insert.run({ ...record });
    },
    markDispatched: (id, at) => {
      dispatched.run(at, id);
    },
    setAttemptedSessionRow: (id, row) => {
      attempted.run(row, id);
    },
    flushPartial: (id, text) => {
      partial.run(text, id);
    },
    settle: (id, resultMessageId) => {
      settle.run(resultMessageId, id);
    },
    unsettled: () => unsettled.all().map((row) => GenerationRow.parse(row)),
    byResultMessage: (messageId) => {
      const row = z.object({ id: z.string(), input_message_id: z.string() }).optional().parse(byResult.get(messageId));
      return row === undefined ? undefined : { id: row.id, inputMessageId: row.input_message_id };
    },
    idsByThread: (threadId) =>
      new Set(idsByThread.all(threadId).map((row) => z.object({ id: z.string() }).parse(row).id)),
    continuation: (threadId, failedMessageId) =>
      z.object({ generation_id: z.string() }).optional().parse(continuation.get(threadId, failedMessageId))?.generation_id,
    insertContinuation: (threadId, failedMessageId, generationId, at) => {
      insertContinuation.run(threadId, failedMessageId, generationId, at);
    },
    insertUsage: ({ usage, outcome, ...record }) => {
      const tokens =
        usage.kind === 'reported'
          ? {
              inputTokens: usage.inputTokens,
              cachedInputTokens: usage.cachedInputTokens,
              cacheWriteTokens: usage.cacheWriteTokens,
              outputTokens: usage.outputTokens,
              reasoningTokens: usage.reasoningTokens,
            }
          : { inputTokens: null, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: null, reasoningTokens: null };
      insertUsage.run({ ...record, ...tokens, outcome: JSON.stringify(outcome) });
    },
  };
}
