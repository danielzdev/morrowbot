import { RunRoutineRequest } from '@morrowbot/contracts';
import type { RoutineService } from './features/routines/index.ts';
import type { SinkAnswer, T3DeliverySink } from './features/t3-watch/index.ts';

/**
 * Delivers T3 watch batches to a background routine of the owning agent (either the watch's bound routine
 * or `defaultRoutineId` from `ORIKAMI_T3_ROUTINE_ID`). Each batch runs in that routine's own chat, never
 * the user's; it holds while the routine or any turn of its agent runs.
 */
export function routineSink(
  routines: RoutineService,
  defaultRoutineId: string | null,
  agentBusy: (agentId: string) => boolean,
): T3DeliverySink {
  const resolve = (routineId?: string | null): string | null => routineId ?? defaultRoutineId;
  return {
    targetFor: (watchRoutineId) => watchRoutineId ?? defaultRoutineId,
    busy: (routineId) => {
      const targetId = resolve(routineId);
      if (targetId === null) return false;
      const routine = routines.get(targetId);
      if (routine === undefined) return false;
      return routine.lastRun?.result.kind === 'running' || agentBusy(routine.agentId);
    },
    deliver: async (batch, routineId): Promise<SinkAnswer> => {
      const targetId = resolve(routineId);
      if (targetId === null) return { kind: 'failed', reason: 'No target routine configured for T3 watch delivery.' };
      const result = await routines.run(targetId, RunRoutineRequest.parse({ payload: batch }));
      switch (result.kind) {
        case 'started':
          return result.run.result.kind === 'failed' ? { kind: 'failed', reason: result.run.result.reason } : { kind: 'sent' };
        case 'busy':
          return { kind: 'busy' };
        case 'not-found':
          return { kind: 'failed', reason: `No routine ${targetId}.` };
        case 'invalid':
          return { kind: 'failed', reason: result.reason };
        case 'wait-closed':
          return { kind: 'failed', reason: 'The routine refused the run.' };
      }
    },
  };
}
