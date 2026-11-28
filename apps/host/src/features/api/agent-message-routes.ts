import { SendAgentMessageRequest, type AgentMessageList } from '@morrowbot/contracts';
import type { ApiServices } from './ports.ts';
import { failure, json, notFound } from './reply.ts';
import { parseBody, type Route } from './route.ts';

export function agentMessageRoutes({ agentMessages }: ApiServices): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/agents/:id/messages',
      access: { kind: 'agent', need: 'view' },
      handle: ({ params, query }) => {
        const messages = agentMessages.list(params.get('id'), query.get('threadId'));
        if (messages === undefined) return notFound('Agent or thread');
        const body: AgentMessageList = { messages };
        return json(200, body);
      },
    },
    {
      method: 'POST',
      path: '/api/agents/:id/messages',
      access: { kind: 'agent', need: 'chat' },
      handle: async (context) => {
        const request = await parseBody(context, SendAgentMessageRequest);
        if (request.kind === 'rejected') return request.reply;
        const sent = agentMessages.send(context.params.get('id'), request.value);
        switch (sent.kind) {
          case 'sent':
            return json(201, sent.message);
          case 'not-found':
            return notFound(sent.what);
          case 'invalid':
            return failure('invalid_request', sent.reason);
          case 'forbidden':
            return failure('forbidden', sent.reason);
          case 'conflict':
            return failure('conflict', sent.reason);
          case 'rate-limited':
            return failure('forbidden', sent.reason, 429);
        }
      },
    },
  ];
}
