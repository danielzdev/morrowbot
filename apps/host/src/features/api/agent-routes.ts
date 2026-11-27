import {
  AgentInstructions,
  type AgentList,
  CreateAgentRequest,
  UpdateAgentRequest,
} from '@morrowbot/contracts';
import type { ApiServices } from './ports.ts';
import { failure, json, noContent, notFound } from './reply.ts';
import { parseBody, type Route } from './route.ts';

export function agentRoutes({ agents, folders, chat }: ApiServices): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/agents',
      handle: () => {
        const body: AgentList = { agents: agents.list(), folders: folders.list(), lastMessages: agents.lastMessages() };
        return json(200, body);
      },
    },
    {
      method: 'POST',
      path: '/api/agents',
      handle: async (context) => {
        const request = await parseBody(context, CreateAgentRequest);
        if (request.kind === 'rejected') return request.reply;
        const created = await agents.create(request.value);
        switch (created.kind) {
          case 'created':
            return json(201, created.agent);
          case 'invalid':
            return failure('invalid_request', created.reason);
        }
      },
    },
    {
      method: 'GET',
      path: '/api/agents/:id',
      handle: ({ params }) => {
        const agent = agents.get(params.get('id'));
        return agent === undefined ? notFound('Agent') : json(200, agent);
      },
    },
    {
      method: 'PATCH',
      path: '/api/agents/:id',
      handle: async (context) => {
        const request = await parseBody(context, UpdateAgentRequest);
        if (request.kind === 'rejected') return request.reply;
        const updated = agents.update(context.params.get('id'), request.value);
        switch (updated.kind) {
          case 'updated':
            return json(200, updated.agent);
          case 'not-found':
            return notFound('Agent');
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
      handle: async ({ params }) => {
        const content = await agents.readInstructions(params.get('id'));
        if (content === undefined) return notFound('Agent');
        const body: AgentInstructions = { content };
        return json(200, body);
      },
    },
    {
      method: 'PUT',
      path: '/api/agents/:id/instructions',
      handle: async (context) => {
        const request = await parseBody(context, AgentInstructions);
        if (request.kind === 'rejected') return request.reply;
        const saved = await agents.writeInstructions(context.params.get('id'), request.value.content);
        return saved ? json(200, request.value) : notFound('Agent');
      },
    },
  ];
}
