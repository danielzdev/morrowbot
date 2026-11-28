import { EntityId, T3RunId, T3ThreadId, Timestamp } from '@morrowbot/contracts';
import { z } from 'zod';
import type { ToolPorts, WatchT3Request } from './ports.ts';
import { done, refused, tool, type Tool } from './tool.ts';

const SHARED_REFUSAL = 'T3 Code watches are not available to agents shared with other people.';

const WatchInput = z.strictObject({
  threadId: T3ThreadId.describe('The T3 Code thread id to watch, e.g. mcp:<uuid>.'),
  routineId: EntityId.describe('The id of your own routine that will receive watch batches for this thread.'),
  runId: T3RunId.optional().describe('The exact T3 Code run id to follow, when known.'),
  priorRunId: T3RunId.optional().describe('The thread’s latest run id before sending, when following a follow-up turn without runId.'),
  exclusive: z.boolean().default(false).describe('True only if nobody else writes to this thread; needed to follow a send without runId.'),
  label: z.string().trim().min(1).max(200).optional().describe('Optional short label for this watch.'),
  launchedAt: Timestamp.optional().describe('ISO-8601 timestamp taken just before starting or sending to the thread; defaults to now.'),
  stallAfterMin: z.int().min(1).max(24 * 60).optional().describe('Minutes without progress before reporting stalled (default 15).'),
});

const UnwatchInput = z
  .strictObject({
    threadId: T3ThreadId.optional().describe('The T3 Code thread id to stop watching.'),
    watchId: EntityId.optional().describe('The specific watch id to remove.'),
  })
  .refine(({ threadId, watchId }) => threadId !== undefined || watchId !== undefined, 'Provide threadId or watchId.');

const AckInput = z.strictObject({
  batchId: EntityId.describe('The batchId from the delivered T3 watch batch or list_t3_watches.'),
  deferredEventIds: z.array(EntityId).max(1000).default([]).describe('Event ids in this batch to re-check and deliver again later.'),
  goneEventIds: z.array(EntityId).max(1000).default([]).describe('Event ids whose thread returned NotFound twice; reopens the watch without settling.'),
});

export function t3WatchTools({ t3Watches }: ToolPorts): Tool[] {
  if (t3Watches === undefined) return [];
  const visible = (agentId: string): boolean => !t3Watches.sharedWithMembers(agentId);
  return [
    tool({
      name: 'list_t3_watches',
      description: 'Lists your active T3 Code watches, pending batches awaiting ack, and pending watch events.',
      input: z.strictObject({
        includeSettled: z.boolean().default(false).describe('Include settled and superseded watches. Defaults to false.'),
      }),
      visible,
      run: (grant, { includeSettled }) => {
        if (t3Watches.sharedWithMembers(grant.agentId)) return refused(SHARED_REFUSAL);
        return done(t3Watches.list(grant.agentId, includeSettled));
      },
    }),
    tool({
      name: 'watch_t3_thread',
      description: 'Registers a T3 Code thread for calm completion watching and routes its batches to one of your own routines.',
      input: WatchInput,
      visible,
      run: (grant, input) => {
        if (t3Watches.sharedWithMembers(grant.agentId)) return refused(SHARED_REFUSAL);
        const request: WatchT3Request = {
          threadId: input.threadId,
          routineId: input.routineId,
          exclusive: input.exclusive,
          ...(input.runId === undefined ? {} : { runId: input.runId }),
          ...(input.priorRunId === undefined ? {} : { priorRunId: input.priorRunId }),
          ...(input.label === undefined ? {} : { label: input.label }),
          ...(input.launchedAt === undefined ? {} : { launchedAt: input.launchedAt }),
          ...(input.stallAfterMin === undefined ? {} : { stallAfterMin: input.stallAfterMin }),
        };
        const outcome = t3Watches.watch(grant.agentId, request);
        switch (outcome.kind) {
          case 'watched':
            return done({ watch: outcome.watch });
          case 'refused':
            return refused(outcome.reason);
        }
      },
    }),
    tool({
      name: 'unwatch_t3_thread',
      description: 'Stops watching a T3 Code thread (by threadId or watchId) owned by you.',
      input: UnwatchInput,
      visible,
      run: (grant, { threadId, watchId }) => {
        if (t3Watches.sharedWithMembers(grant.agentId)) return refused(SHARED_REFUSAL);
        const outcome = t3Watches.unwatch(grant.agentId, {
          ...(threadId === undefined ? {} : { threadId }),
          ...(watchId === undefined ? {} : { watchId }),
        });
        switch (outcome.kind) {
          case 'unwatched':
            return done({ threadId: outcome.threadId, removedWatchIds: outcome.removedWatchIds });
          case 'not-found':
            return refused(watchId !== undefined ? `No T3 watch ${watchId}` : `No T3 watch for thread ${threadId ?? ''}`);
        }
      },
    }),
    tool({
      name: 'ack_t3_batch',
      description: 'Acknowledges a delivered T3 watch batch after handling, deferring, or marking gone every event in it.',
      input: AckInput,
      visible,
      run: (grant, input) => {
        if (t3Watches.sharedWithMembers(grant.agentId)) return refused(SHARED_REFUSAL);
        const outcome = t3Watches.ack(grant.agentId, input);
        switch (outcome.kind) {
          case 'acked':
          case 'already_acked':
            return done({ batchId: input.batchId, result: outcome.kind });
          case 'unknown_batch':
            return refused(`Unknown T3 watch batch ${input.batchId}`);
        }
      },
    }),
  ];
}
