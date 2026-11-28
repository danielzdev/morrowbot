import { mainThread, RunRoutineRequest, type T3WatchBatch, type T3WatchEvent } from '@morrowbot/contracts';
import type { ChatService } from './features/chat/index.ts';
import type { RoutineService } from './features/routines/index.ts';
import type { Storage } from './features/storage/index.ts';
import type { SinkAnswer, T3DeliverySink } from './features/t3-watch/index.ts';

type WatchEvent = Extract<T3WatchEvent, { scope: 'watch' }>;

function idleUnverifiedNotice(batch: T3WatchBatch, events: readonly WatchEvent[]): string {
  return events
    .map((event) => {
      const row = batch.status.find((each) => each.watchId === event.watchId);
      const name = row?.label ? `${row.label} (${event.threadId})` : event.threadId;
      const detail = event.reason ? ` (${event.reason})` : '';
      return `Stopped tracking ${name}, not confirmed finished${detail}.`;
    })
    .join('\n');
}

/**
 * Delivers T3 watch batches to a background routine of the owning agent (either the watch's bound routine
 * or `defaultRoutineId` from `ORIBOT_T3_ROUTINE_ID`). The batch runs in the routine's own chat (holding
 * while the routine or any turn of its agent runs), and its report is delivered as a normal assistant
 * message to the chat that created the watch (or the agent's main chat). `idle_unverified` closes are
 * always reported clearly in that chat, never silently closed.
 */
export function routineSink(
  routines: RoutineService,
  storage: Storage,
  chat: Pick<ChatService, 'agentBusy' | 'postAssistantMessage'>,
  defaultRoutineId: string | null,
): T3DeliverySink {
  const notifiedIdleUnverified = new Set<string>();

  const isDeliverable = (threadId: string, agentId: string, excludeThreadId: string | null): boolean => {
    if (threadId === excludeThreadId) return false;
    const thread = storage.threads.get(threadId);
    return thread !== undefined && thread.agentId === agentId && thread.archivedAt === null && storage.subagents.get(threadId) === undefined;
  };

  const resolveChat = (agentId: string, preferredThreadId: string | null, excludeThreadId: string | null = null): string | null => {
    if (preferredThreadId !== null && isDeliverable(preferredThreadId, agentId, excludeThreadId)) return preferredThreadId;
    const candidates = storage.threads.listByAgent(agentId).filter((thread) => thread.id !== excludeThreadId);
    return mainThread(candidates)?.id ?? null;
  };

  const unnotifiedIdleUnverified = (batch: T3WatchBatch): WatchEvent[] =>
    batch.events.flatMap(({ event }) =>
      event.scope === 'watch' && event.kind === 'idle_unverified' && !notifiedIdleUnverified.has(event.eventId) ? [event] : [],
    );

  const postIdleUnverifiedFallback = (batch: T3WatchBatch, threadId: string | null): void => {
    if (threadId === null) return;
    const pending = unnotifiedIdleUnverified(batch);
    if (pending.length === 0) return;
    if (chat.postAssistantMessage(threadId, idleUnverifiedNotice(batch, pending)) !== undefined) {
      for (const event of pending) notifiedIdleUnverified.add(event.eventId);
    }
  };

  return {
    targetFor: (watch) => {
      const routineId = watch.routineId ?? defaultRoutineId;
      if (routineId === null) return null;
      const routine = routines.get(routineId);
      const chatThreadId = routine === undefined ? watch.chatThreadId : resolveChat(routine.agentId, watch.chatThreadId);
      return { routineId, chatThreadId };
    },
    busy: (target) => {
      const routineId = target?.routineId ?? defaultRoutineId;
      if (routineId === null) return false;
      const routine = routines.get(routineId);
      if (routine === undefined) return false;
      return routine.lastRun?.result.kind === 'running' || chat.agentBusy(routine.agentId);
    },
    deliver: async (batch, target): Promise<SinkAnswer> => {
      const routineId = target?.routineId ?? defaultRoutineId;
      if (routineId === null) return { kind: 'failed', reason: 'No target routine configured for T3 watch delivery.' };
      const routine = routines.get(routineId);
      const preferredChat = target?.chatThreadId ?? null;
      if (routine === undefined) {
        postIdleUnverifiedFallback(batch, preferredChat);
        return { kind: 'failed', reason: `No routine ${routineId}.` };
      }
      const replyThreadId = resolveChat(routine.agentId, preferredChat);
      const result = await routines.run(routineId, RunRoutineRequest.parse({ payload: batch }), {
        replyThreadId,
        onSettled: (outcome, runThreadId) => {
          const dest = resolveChat(routine.agentId, preferredChat, runThreadId);
          if (dest === null) return;
          if (outcome.kind === 'posted' && outcome.text.trim() !== '') {
            if (chat.postAssistantMessage(dest, outcome.text) !== undefined) {
              for (const event of unnotifiedIdleUnverified(batch)) notifiedIdleUnverified.add(event.eventId);
            }
            return;
          }
          postIdleUnverifiedFallback(batch, dest);
        },
      });
      switch (result.kind) {
        case 'started':
          return result.run.result.kind === 'failed' ? { kind: 'failed', reason: result.run.result.reason } : { kind: 'sent' };
        case 'busy':
          return { kind: 'busy' };
        case 'not-found':
          postIdleUnverifiedFallback(batch, preferredChat);
          return { kind: 'failed', reason: `No routine ${routineId}.` };
        case 'invalid':
          return { kind: 'failed', reason: result.reason };
        case 'wait-closed':
          return { kind: 'failed', reason: 'The routine refused the run.' };
      }
    },
  };
}
