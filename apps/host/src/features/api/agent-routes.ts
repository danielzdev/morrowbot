import {
  type AgentList,
  CreateAgentRequest,
  InstructionsCopyRequest,
  type InstructionsCopyReply,
  type ProviderBinding,
  PutInstructionsRequest,
  type PutInstructionsReply,
  UpdateAgentRequest,
} from '@morrowbot/contracts';
import { sees } from './access.ts';
import type { ApiServices } from './ports.ts';
import { agentConflict, failure, instructionsConflict, json, noContent, notFound } from './reply.ts';
import { parseBody, type Route, type RouteContext } from './route.ts';

const FULL_OWNER_ONLY = 'Only the owner of this computer may give an agent full access (shell commands)';

/** Whether a server member, co-owners too, asks for full access: it runs commands on the owner's computer. */
function fullByMember(context: RouteContext, provider: ProviderBinding | undefined): boolean {
  return context.whoAmI.kind === 'member' && provider?.kind === 'bound' && provider.access === 'full';
}

export function agentRoutes({ agents, folders, chat }: ApiServices): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/agents',
      access: { kind: 'signed-in' },
      handle: ({ viewer }) => {
        if (viewer.kind === 'owner') {
          const body: AgentList = { agents: agents.list(), folders: folders.list(), lastMessages: agents.lastMessages() };
          return json(200, body);
        }
        const body: AgentList = {
          agents: agents.list().flatMap((agent) => (sees(viewer, agent.id) ? [{ ...agent, folderId: null }] : [])),
          folders: [],
          lastMessages: agents.lastMessages().filter(({ agentId }) => sees(viewer, agentId)),
        };
        return json(200, body);
      },
    },
    {
      method: 'POST',
      path: '/api/agents',
      handle: async (context) => {
        const request = await parseBody(context, CreateAgentRequest);
        if (request.kind === 'rejected') return request.reply;
        if (fullByMember(context, request.value.provider)) return failure('forbidden', FULL_OWNER_ONLY);
        const created = await agents.create(request.value);
        switch (created.kind) {
          case 'created':
            return json(201, created.agent);
          case 'invalid':
            return failure('invalid_request', created.reason);
          case 'instructions-occupied':
            return instructionsConflict('occupied', created.current);
          case 'failed':
            return failure('internal', created.message);
        }
      },
    },
    {
      method: 'GET',
      path: '/api/agents/:id',
      access: { kind: 'agent', need: 'view' },
      handle: ({ params }) => {
        const agent = agents.get(params.get('id'));
        return agent === undefined ? notFound('Agent') : json(200, agent);
      },
    },
    {
      method: 'PATCH',
      path: '/api/agents/:id',
      access: { kind: 'agent', need: 'edit' },
      handle: async (context) => {
        const request = await parseBody(context, UpdateAgentRequest);
        if (request.kind === 'rejected') return request.reply;
        if (
          context.viewer.kind === 'scoped' &&
          (request.value.provider !== undefined || request.value.folderId !== undefined || request.value.disabledExtensions !== undefined)
        ) {
          return failure('forbidden', "Only the server owner may change an agent's engine, folder or extensions");
        }
        if (fullByMember(context, request.value.provider)) return failure('forbidden', FULL_OWNER_ONLY);
        const updated = agents.update(context.params.get('id'), request.value);
        switch (updated.kind) {
          case 'updated':
            return json(200, updated.agent);
          case 'not-found':
            return notFound('Agent');
          case 'conflict':
            return agentConflict(context.viewer.kind === 'scoped' ? { ...updated.current, folderId: null } : updated.current);
          case 'invalid':
            return failure('invalid_request', updated.reason);
        }
      },
    },
    {
      method: 'DELETE',
      path: '/api/agents/:id',
      handle: async ({ params }) => ((await chat.deleteAgent(params.get('id'))) ? noContent() : notFound('Agent')),
    },
    {
      method: 'GET',
      path: '/api/agents/:id/instructions',
      access: { kind: 'agent', need: 'view' },
      handle: async ({ params }) => {
        const view = await agents.instructionsView(params.get('id'));
        return view === undefined ? notFound('Agent') : json(200, view);
      },
    },
    {
      method: 'PUT',
      path: '/api/agents/:id/instructions',
      access: { kind: 'agent', need: 'edit' },
      handle: async (context) => {
        const request = await parseBody(context, PutInstructionsRequest);
        if (request.kind === 'rejected') return request.reply;
        const id = context.params.get('id');
        if (request.value.expectedRevision !== null) {
          const current = await agents.instructionsView(id);
          return current === undefined ? notFound('Agent') : instructionsConflict('replace-unavailable', current);
        }
        const created = await agents.createInstructions(id, request.value.content);
        if (created === undefined) return notFound('Agent');
        switch (created.kind) {
          case 'created': {
            const body: PutInstructionsReply = { revision: created.revision };
            return json(200, body);
          }
          case 'occupied': {
            const current = await agents.instructionsView(id);
            return current === undefined ? notFound('Agent') : instructionsConflict('occupied', current);
          }
          case 'failed':
            return failure('internal', created.message);
        }
      },
    },
    {
      method: 'POST',
      path: '/api/agents/:id/instructions/copies',
      access: { kind: 'agent', need: 'edit' },
      handle: async (context) => {
        const request = await parseBody(context, InstructionsCopyRequest);
        if (request.kind === 'rejected') return request.reply;
        const saved = await agents.saveInstructionsCopy(context.params.get('id'), request.value.content);
        if (saved === undefined) return notFound('Agent');
        switch (saved.kind) {
          case 'saved': {
            const body: InstructionsCopyReply = { revealId: saved.name };
            return json(201, body);
          }
          case 'failed':
            return failure('internal', saved.message);
        }
      },
    },
  ];
}
