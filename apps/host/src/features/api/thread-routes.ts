import {
  ApprovalReplyRequest,
  type ContinueResponse,
  ContinueRequest,
  CreateThreadRequest,
  type MessageList,
  SendMessageRequest,
  type SendMessageResponse,
  type ThreadList,
  UpdateThreadRequest,
} from '@morrowbot/contracts';
import { refusal } from './admit-reply.ts';
import { sees } from './access.ts';
import type { ApiQueueAnswer, ApiServices } from './ports.ts';
import { failure, json, noContent, notFound, type Reply } from './reply.ts';
import { parseBody, type Route } from './route.ts';

export function threadRoutes({ chat }: ApiServices): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/threads',
      access: { kind: 'signed-in' },
      handle: ({ viewer }) => {
        const body: ThreadList = { threads: chat.listAllThreads().filter(({ agentId }) => sees(viewer, agentId)) };
        return json(200, body);
      },
    },
    {
      method: 'GET',
      path: '/api/agents/:id/threads',
      access: { kind: 'agent', need: 'view' },
      handle: ({ params }) => {
        const threads = chat.listThreads(params.get('id'));
        if (threads === undefined) return notFound('Agent');
        const body: ThreadList = { threads };
        return json(200, body);
      },
    },
    {
      method: 'POST',
      path: '/api/agents/:id/threads',
      access: { kind: 'agent', need: 'view' },
      handle: async (context) => {
        const request = await parseBody(context, CreateThreadRequest);
        if (request.kind === 'rejected') return request.reply;
        const thread = chat.createThread(context.params.get('id'), request.value);
        return thread === undefined ? notFound('Agent') : json(201, thread);
      },
    },
    {
      method: 'GET',
      path: '/api/threads/:id',
      access: { kind: 'thread', need: 'view' },
      handle: ({ params }) => {
        const thread = chat.getThread(params.get('id'));
        return thread === undefined ? notFound('Thread') : json(200, thread);
      },
    },
    {
      method: 'PATCH',
      path: '/api/threads/:id',
      access: { kind: 'thread', need: 'view' },
      handle: async (context) => {
        const request = await parseBody(context, UpdateThreadRequest);
        if (request.kind === 'rejected') return request.reply;
        const thread = chat.renameThread(context.params.get('id'), request.value.title);
        return thread === undefined ? notFound('Thread') : json(200, thread);
      },
    },
    {
      method: 'DELETE',
      path: '/api/threads/:id',
      access: { kind: 'thread', need: 'edit' },
      handle: async ({ params }) => ((await chat.deleteThread(params.get('id'))) ? noContent() : notFound('Thread')),
    },
    {
      method: 'GET',
      path: '/api/threads/:id/state',
      access: { kind: 'thread', need: 'view' },
      handle: ({ params }) => {
        const state = chat.state(params.get('id'));
        return state === undefined ? notFound('Thread') : json(200, state);
      },
    },
    {
      method: 'GET',
      path: '/api/threads/:id/messages',
      access: { kind: 'thread', need: 'view' },
      handle: ({ params }) => {
        const messages = chat.listMessages(params.get('id'));
        if (messages === undefined) return notFound('Thread');
        const body: MessageList = { messages };
        return json(200, body);
      },
    },
    {
      method: 'POST',
      path: '/api/threads/:id/messages',
      access: { kind: 'thread', need: 'chat' },
      handle: async (context) => {
        const request = await parseBody(context, SendMessageRequest);
        if (request.kind === 'rejected') return request.reply;
        const { text, attachmentIds, sessionChoice } = request.value;
        const result = await chat.send(context.params.get('id'), text, attachmentIds, sessionChoice);
        if (result.kind === 'queued') {
          const body: SendMessageResponse = { kind: 'queued', queued: result.queued };
          return json(202, body);
        }
        if (result.kind === 'files_wait') return failure('conflict', 'Files can be sent once this reply ends. Send the text alone to queue it.');
        if (result.kind !== 'started') return refusal(result);
        if (result.userMessage === null) return failure('internal', 'The send started without its message');
        const body: SendMessageResponse = { kind: 'started', generationId: result.generationId, userMessage: result.userMessage };
        return json(202, body);
      },
    },
    {
      method: 'DELETE',
      path: '/api/threads/:id/queue/:queuedId',
      access: { kind: 'thread', need: 'view' },
      handle: ({ params }) => queueReply(chat.cancelQueued(params.get('id'), params.get('queuedId')), noContent),
    },
    {
      method: 'POST',
      path: '/api/threads/:id/queue/:queuedId/steer',
      access: { kind: 'thread', need: 'chat' },
      handle: ({ params }) => queueReply(chat.steerQueued(params.get('id'), params.get('queuedId')), noContent),
    },
    {
      method: 'POST',
      path: '/api/threads/:id/continue',
      access: { kind: 'thread', need: 'chat' },
      handle: async (context) => {
        const request = await parseBody(context, ContinueRequest);
        if (request.kind === 'rejected') return request.reply;
        const { failedMessageId, sessionChoice } = request.value;
        const result = await chat.continueTurn(context.params.get('id'), failedMessageId, sessionChoice);
        if (result.kind !== 'started') return refusal(result);
        const body: ContinueResponse = { generationId: result.generationId };
        return json(202, body);
      },
    },
    {
      method: 'POST',
      path: '/api/threads/:id/approvals/:approvalId',
      access: { kind: 'thread', need: 'chat' },
      handle: async (context) => {
        const request = await parseBody(context, ApprovalReplyRequest);
        if (request.kind === 'rejected') return request.reply;
        const { generationId, choiceId } = request.value;
        const result = chat.replyApproval(context.params.get('id'), generationId, context.params.get('approvalId'), choiceId);
        switch (result.kind) {
          case 'replied':
            return noContent();
          case 'not_found':
            return notFound('Approval');
        }
      },
    },
    {
      method: 'POST',
      path: '/api/threads/:id/stop',
      access: { kind: 'thread', need: 'view' },
      handle: async ({ params }) => {
        const id = params.get('id');
        if (chat.getThread(id) === undefined) return notFound('Thread');
        const stopped = await chat.stop(id);
        if (stopped.kind === 'not_stored') return failure('internal', 'The reply could not be saved. Restart MorrowBot to finish this turn.');
        return json(200, stopped);
      },
    },
  ];
}

function queueReply(answer: ApiQueueAnswer, ok: () => Reply): Reply {
  switch (answer.kind) {
    case 'ok':
      return ok();
    case 'not_found':
      return notFound('Queued message');
    case 'conflict':
      return failure('conflict', answer.reason);
  }
}
