import { CreateRoutineRequest, EntityId, RoutineSchedule, type Routine, type UpdateRoutineRequest } from '@morrowbot/contracts';
import { z } from 'zod';
import type { RoutineSaveResult, ToolPorts } from './ports.ts';
import { done, refused, tool, type Tool, type ToolResult } from './tool.ts';

const SHARED_REFUSAL = 'Routines are not available to agents shared with other people.';

const shown = ({
  id,
  title,
  instruction,
  schedule,
  active,
  stayQuietIfNothingNew,
  nextRunAt,
  lastRunAt,
  lastRun,
}: Routine) => ({
  id,
  title,
  instruction,
  schedule,
  active,
  stayQuietIfNothingNew,
  nextRunAt,
  lastRunAt,
  lastRun: lastRun === null ? null : { id: lastRun.id, trigger: lastRun.trigger, at: lastRun.at, result: lastRun.result },
});

const CreateInput = z.strictObject({
  title: CreateRoutineRequest.shape.title.describe('Short title for the routine.'),
  instruction: CreateRoutineRequest.shape.instruction.describe('Prompt sent to you whenever the routine runs.'),
  schedule: RoutineSchedule.describe('When the routine runs: cron ({ kind: "cron", expr, timezone }), one-time ({ kind: "once", runAt }), or manual ({ kind: "manual" }).'),
  active: z.boolean().default(true).describe('Whether the schedule is enabled (false creates a paused routine).'),
  stayQuietIfNothingNew: z.boolean().default(false).describe('Whether quiet runs are allowed to remove their temporary chat when nothing is new.'),
});

const UpdateInput = z
  .strictObject({
    routineId: EntityId.describe('The id of your routine to update.'),
    title: CreateRoutineRequest.shape.title.optional().describe('New title for the routine.'),
    instruction: CreateRoutineRequest.shape.instruction.optional().describe('New instruction prompt for the routine.'),
    schedule: RoutineSchedule.optional().describe('New schedule for the routine.'),
    active: z.boolean().optional().describe('Set true to enable or false to pause the routine schedule.'),
    stayQuietIfNothingNew: z.boolean().optional().describe('Whether quiet runs are allowed to remove their temporary chat.'),
  })
  .refine(
    ({ title, instruction, schedule, active, stayQuietIfNothingNew }) =>
      title !== undefined || instruction !== undefined || schedule !== undefined || active !== undefined || stayQuietIfNothingNew !== undefined,
    'Change at least one field',
  );

function savedResult(result: RoutineSaveResult, notFoundMessage: string): ToolResult {
  switch (result.kind) {
    case 'saved':
      return done({ routine: shown(result.routine) });
    case 'not-found':
      return refused(notFoundMessage);
    case 'invalid':
      return refused(result.reason);
  }
}

export function routineTools({ routines }: ToolPorts): Tool[] {
  if (routines === undefined) return [];
  const visible = (agentId: string): boolean => !routines.sharedWithMembers(agentId);
  return [
    tool({
      name: 'list_routines',
      description: 'Lists your own routines with their id, title, schedule, enabled state, nextRunAt, lastRunAt and lastRun.',
      input: z.strictObject({}),
      visible,
      run: (grant) => {
        if (routines.sharedWithMembers(grant.agentId)) return refused(SHARED_REFUSAL);
        const list = routines.list(grant.agentId);
        return list === undefined ? refused('Agent not found') : done({ routines: list.map(shown) });
      },
    }),
    tool({
      name: 'create_routine',
      description: 'Creates a cron, one-time, or manual/paused routine owned by you.',
      input: CreateInput,
      visible,
      run: (grant, input) => {
        if (routines.sharedWithMembers(grant.agentId)) return refused(SHARED_REFUSAL);
        return savedResult(routines.create({ agentId: grant.agentId, ...input }), 'Agent not found');
      },
    }),
    tool({
      name: 'update_routine',
      description: 'Updates the title, instruction, schedule, enabled state, or quiet mode of one of your own routines.',
      input: UpdateInput,
      visible,
      run: (grant, { routineId, title, instruction, schedule, active, stayQuietIfNothingNew }) => {
        if (routines.sharedWithMembers(grant.agentId)) return refused(SHARED_REFUSAL);
        const patch: UpdateRoutineRequest = {
          ...(title === undefined ? {} : { title }),
          ...(instruction === undefined ? {} : { instruction }),
          ...(schedule === undefined ? {} : { schedule }),
          ...(active === undefined ? {} : { active }),
          ...(stayQuietIfNothingNew === undefined ? {} : { stayQuietIfNothingNew }),
        };
        return savedResult(routines.update(grant.agentId, routineId, patch), `You have no routine ${routineId}`);
      },
    }),
    tool({
      name: 'delete_routine',
      description: 'Deletes one of your own routines for good.',
      input: z.strictObject({ routineId: EntityId.describe('The id of your routine to delete.') }),
      visible,
      run: (grant, { routineId }) => {
        if (routines.sharedWithMembers(grant.agentId)) return refused(SHARED_REFUSAL);
        return routines.delete(grant.agentId, routineId) ? done({ deleted: routineId }) : refused(`You have no routine ${routineId}`);
      },
    }),
    tool({
      name: 'routine_no_update',
      description: 'Marks the current routine run as silent (nothing to report or notify), removing its temporary chat when the turn completes.',
      input: z.strictObject({ reason: z.string().trim().max(500).optional().describe('Optional short note explaining why nothing needs attention.') }),
      visible,
      run: (grant, { reason }) => {
        if (routines.sharedWithMembers(grant.agentId)) return refused(SHARED_REFUSAL);
        const outcome = routines.markNoUpdate(grant.agentId, grant.threadId);
        switch (outcome.kind) {
          case 'marked':
            return done({ silent: true, routineId: outcome.routineId, runId: outcome.runId, ...(reason === undefined ? {} : { reason }) });
          case 'not-a-routine-run':
            return refused('routine_no_update can only be called during a routine run.');
        }
      },
    }),
  ];
}
