import { RunRoutineRequest } from '@morrowbot/contracts';
import type { RoutineService } from './features/routines/index.ts';
import type { SinkAnswer, T3DeliverySink } from './features/t3-watch/index.ts';

/**
 * Delivers T3 watch batches to one background routine of the orchestrator agent. Each batch runs in that routine's
 * own chat, never the user's; it holds while the routine or any turn of the orchestrator runs.
 */
export function routineSink(routines: RoutineService, routineId: string, agentBusy: (agentId: string) => boolean): T3DeliverySink {
  return {
    busy: () => {
      const routine = routines.list().find((each) => each.id === routineId);
      if (routine === undefined) return false;
      return routine.lastRun?.result.kind === 'running' || agentBusy(routine.agentId);
    },
    deliver: async (batch): Promise<SinkAnswer> => {
      const result = await routines.run(routineId, RunRoutineRequest.parse({ payload: batch }));
      switch (result.kind) {
        case 'started':
          return result.run.result.kind === 'failed' ? { kind: 'failed', reason: result.run.result.reason } : { kind: 'sent' };
        case 'busy':
          return { kind: 'busy' };
        case 'not-found':
          return { kind: 'failed', reason: `No routine ${routineId} (MORROWBOT_T3_ROUTINE_ID).` };
        case 'invalid':
          return { kind: 'failed', reason: result.reason };
        case 'wait-closed':
          return { kind: 'failed', reason: 'The routine refused the run.' };
      }
    },
  };
}
