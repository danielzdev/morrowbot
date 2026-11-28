import {
  CreateRoutineRequest,
  OpenWaitRequest,
  type RoutineList,
  RunRoutineRequest,
  type RunRoutineResponse,
  UpdateRoutineRequest,
  type WaitList,
} from '@morrowbot/contracts';
import type { ApiRoutineSave, ApiServices } from './ports.ts';
import { failure, json, noContent, notFound, type Reply } from './reply.ts';
import { parseBody, type Route } from './route.ts';

function saved(result: ApiRoutineSave, status: number): Reply {
  switch (result.kind) {
    case 'saved':
      return json(status, result.routine);
    case 'not-found':
      return notFound('Routine');
    case 'invalid':
      return failure('invalid_request', result.reason);
  }
}

/** Routines and waits. Every route needs a token, so a local script calls them with the desktop's or a paired device's. */
export function routineRoutes({ routines }: ApiServices): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/routines',
      handle: ({ query }) => {
        const agentId = query.get('agentId');
        const body: RoutineList = { routines: routines.list(agentId ?? undefined) };
        return json(200, body);
      },
    },
    {
      method: 'POST',
      path: '/api/routines',
      handle: async (context) => {
        const request = await parseBody(context, CreateRoutineRequest);
        return request.kind === 'rejected' ? request.reply : saved(routines.create(request.value), 201);
      },
    },
    {
      method: 'PATCH',
      path: '/api/routines/:id',
      handle: async (context) => {
        const request = await parseBody(context, UpdateRoutineRequest);
        return request.kind === 'rejected' ? request.reply : saved(routines.update(context.params.get('id'), request.value), 200);
      },
    },
    {
      method: 'DELETE',
      path: '/api/routines/:id',
      handle: ({ params }) => (routines.delete(params.get('id')) ? noContent() : notFound('Routine')),
    },
    {
      method: 'POST',
      path: '/api/routines/:id/run',
      handle: async (context) => {
        const request = await parseBody(context, RunRoutineRequest);
        if (request.kind === 'rejected') return request.reply;
        const result = await routines.run(context.params.get('id'), request.value);
        switch (result.kind) {
          case 'started': {
            const body: RunRoutineResponse = { run: result.run };
            return json(202, body);
          }
          case 'not-found':
            return notFound('Routine');
          case 'busy':
            return failure('conflict', 'This routine is still running. Try again once it finishes.');
          case 'invalid':
            return failure('invalid_request', result.reason);
          case 'wait-closed':
            return failure('conflict', 'That wait was woken or closed already.');
        }
      },
    },
    {
      method: 'GET',
      path: '/api/waits',
      handle: () => {
        const body: WaitList = { waits: routines.listWaits() };
        return json(200, body);
      },
    },
    {
      method: 'POST',
      path: '/api/waits',
      handle: async (context) => {
        const request = await parseBody(context, OpenWaitRequest);
        if (request.kind === 'rejected') return request.reply;
        const opened = routines.openWait(request.value);
        return opened.kind === 'opened' ? json(201, opened.wait) : failure('invalid_request', opened.reason);
      },
    },
    {
      method: 'DELETE',
      path: '/api/waits/:id',
      handle: ({ params }) => (routines.closeWait(params.get('id')) ? noContent() : notFound('Wait')),
    },
  ];
}
