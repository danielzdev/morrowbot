import {
  AgentInstructions,
  type AgentList,
  CreateAgentRequest,
  UpdateAgentRequest,
} from '@morrowbot/contracts';
import type { ApiServices } from './ports.ts';
import { json, noContent, notFound } from './reply.ts';
import { parseBody, type Route } from './route.ts';

export function agentRoutes({ agents, chat }: ApiServices): Route[] {
  return [
    {
      method: 'GET',
      path: /^\/api\/agents$/,
      handle: () => {
        const body: AgentList = { agents: agents.list() };
        return json(200, body);
      },
    },
    {
      method: 'POST',
      path: /^\/api\/agents$/,
      handle: async (context) => {
        const request = await parseBody(context, CreateAgentRequest);
        if (request.kind === 'rejected') return request.reply;
        return json(201, await agents.create(request.value));
      },
    },
    {
      method: 'GET',
      path: /^\/api\/agents\/([^/]+)$/,
      handle: ({ id }) => {
        const agent = agents.get(id);
        return agent === undefined ? notFound('Agent') : json(200, agent);
      },
    },
    {
      method: 'PATCH',
      path: /^\/api\/agents\/([^/]+)$/,
      handle: async (context) => {
        const request = await parseBody(context, UpdateAgentRequest);
        if (request.kind === 'rejected') return request.reply;
        const agent = agents.update(context.id, request.value);
        return agent === undefined ? notFound('Agent') : json(200, agent);
      },
    },
    {
      method: 'DELETE',
      path: /^\/api\/agents\/([^/]+)$/,
      handle: async ({ id }) => {
        if (agents.get(id) === undefined) return notFound('Agent');
        await chat.stopAgent(id);
        return agents.delete(id) ? noContent() : notFound('Agent');
      },
    },
    {
      method: 'GET',
      path: /^\/api\/agents\/([^/]+)\/instructions$/,
      handle: async ({ id }) => {
        const content = await agents.readInstructions(id);
        if (content === undefined) return notFound('Agent');
        const body: AgentInstructions = { content };
        return json(200, body);
      },
    },
    {
      method: 'PUT',
      path: /^\/api\/agents\/([^/]+)\/instructions$/,
      handle: async (context) => {
        const request = await parseBody(context, AgentInstructions);
        if (request.kind === 'rejected') return request.reply;
        const saved = await agents.writeInstructions(context.id, request.value.content);
        return saved ? json(200, request.value) : notFound('Agent');
      },
    },
  ];
}
