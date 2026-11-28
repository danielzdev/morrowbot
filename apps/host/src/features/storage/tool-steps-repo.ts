import type { DatabaseSync } from 'node:sqlite';
import { ToolStep, type MessageToolSteps } from '@morrowbot/contracts';
import { z } from 'zod';
import { jsonColumn } from './columns.ts';

const ToolStepRow = z
  .object({
    tool_use_id: z.string(),
    name: z.string(),
    input: jsonColumn(z.json()),
    outcome: z.string(),
    started_at: z.string(),
    ended_at: z.string().nullable(),
  })
  .transform((row) => {
    const base = { toolUseId: row.tool_use_id, name: row.name, input: row.input, outcome: row.outcome, startedAt: row.started_at };
    return row.ended_at === null ? base : { ...base, endedAt: row.ended_at };
  })
  .pipe(ToolStep);

const LinkedRow = z.object({ message_id: z.string() });

export interface StartedToolStep {
  readonly generationId: string;
  readonly toolUseId: string;
  readonly name: string;
  readonly input: ToolStep['input'];
  readonly startedAt: string;
}

export interface ToolStepRepository {
  /** Saves a tool call that started; a repeated start of the same call is ignored. */
  start(step: StartedToolStep): void;
  /** Ends a running call. A call already ended, or no longer running, is left as it is. */
  end(generationId: string, toolUseId: string, outcome: 'ok' | 'error', endedAt: string): void;
  /** The turn's calls not yet on a saved reply, oldest first. */
  listOpen(generationId: string): ToolStep[];
  /**
   * Puts the turn's open calls on its reply `messageId`, a running one ending as unfinished. With no reply (a turn
   * that added nothing to the chat) they are dropped.
   */
  close(generationId: string, messageId: string | null): void;
  /** Each reply's calls, replies in message order. */
  listByThread(threadId: string): MessageToolSteps[];
}

export function toolStepRepository(db: DatabaseSync): ToolStepRepository {
  const start = db.prepare(
    `INSERT INTO tool_steps (generation_id, tool_use_id, name, input, outcome, started_at)
     VALUES (:generationId, :toolUseId, :name, :input, 'running', :startedAt)
     ON CONFLICT (generation_id, tool_use_id) DO NOTHING`,
  );
  const end = db.prepare(
    `UPDATE tool_steps SET outcome = ?, ended_at = ?
     WHERE generation_id = ? AND tool_use_id = ? AND message_id IS NULL AND outcome = 'running'`,
  );
  const listOpen = db.prepare('SELECT * FROM tool_steps WHERE generation_id = ? AND message_id IS NULL ORDER BY seq');
  const unfinish = db.prepare(`UPDATE tool_steps SET outcome = 'unfinished' WHERE generation_id = ? AND message_id IS NULL AND outcome = 'running'`);
  const link = db.prepare('UPDATE tool_steps SET message_id = ? WHERE generation_id = ? AND message_id IS NULL');
  const drop = db.prepare('DELETE FROM tool_steps WHERE generation_id = ? AND message_id IS NULL');
  const listByThread = db.prepare(
    `SELECT s.* FROM tool_steps s JOIN messages m ON m.id = s.message_id WHERE m.thread_id = ? ORDER BY m.seq, s.seq`,
  );
  return {
    start: (step) => {
      start.run({ ...step, input: JSON.stringify(step.input) });
    },
    end: (generationId, toolUseId, outcome, endedAt) => {
      end.run(outcome, endedAt, generationId, toolUseId);
    },
    listOpen: (generationId) => listOpen.all(generationId).map((row) => ToolStepRow.parse(row)),
    close: (generationId, messageId) => {
      if (messageId === null) {
        drop.run(generationId);
        return;
      }
      unfinish.run(generationId);
      link.run(messageId, generationId);
    },
    listByThread: (threadId) => {
      const replies: { messageId: string; steps: ToolStep[] }[] = [];
      for (const row of listByThread.all(threadId)) {
        const { message_id: messageId } = LinkedRow.parse(row);
        const step = ToolStepRow.parse(row);
        const last = replies.at(-1);
        if (last?.messageId === messageId) last.steps.push(step);
        else replies.push({ messageId, steps: [step] });
      }
      return replies;
    },
  };
}
