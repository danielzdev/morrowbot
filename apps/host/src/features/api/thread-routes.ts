import {
  CreateThreadRequest,
  type MessageList,
  SendMessageRequest,
  type SendMessageResponse,
  type ThreadList,
  UpdateThreadRequest,
} from '@morrowbot/contracts';
import type { ApiServices } from './ports.ts';
import { failure, json, noContent, notFound } from './reply.ts';
import { parseBody, type Route } from './route.ts';

export function threadRoutes({ chat }: ApiServices): Route[] {
  return [
    {
      method: 'GET',
      path: /^\/api\/agents\/([^/]+)\/threads$/,
      handle: ({ id }) => {
        const threads = chat.listThreads(id);
        if (threads === undefined) return notFound('Agent');
        const body: ThreadList = { threads };
        return json(200, body);
      },
    },
    {
      method: 'POST',
      path: /^\/api\/agents\/([^/]+)\/threads$/,
      handle: async (context) => {
        const request = await parseBody(context, CreateThreadRequest);
        if (request.kind === 'rejected') return request.reply;
        const thread = chat.createThread(context.id, request.value);
        return thread === undefined ? notFound('Agent') : json(201, thread);
      },
    },
    {
      method: 'GET',
      path: /^\/api\/threads\/([^/]+)$/,
      handle: ({ id }) => {
        const thread = chat.getThread(id);
        return thread === undefined ? notFound('Thread') : json(200, thread);
      },
    },
    {
      method: 'PATCH',
      path: /^\/api\/threads\/([^/]+)$/,
      handle: async (context) => {
        const request = await parseBody(context, UpdateThreadRequest);
        if (request.kind === 'rejected') return request.reply;
        const thread = chat.renameThread(context.id, request.value.title);
        return thread === undefined ? notFound('Thread') : json(200, thread);
      },
    },
    {
      method: 'DELETE',
      path: /^\/api\/threads\/([^/]+)$/,
      handle: async ({ id }) => ((await chat.deleteThread(id)) ? noContent() : notFound('Thread')),
    },
    {
      method: 'GET',
      path: /^\/api\/threads\/([^/]+)\/messages$/,
      handle: ({ id }) => {
        const messages = chat.listMessages(id);
        if (messages === undefined) return notFound('Thread');
        const body: MessageList = { messages };
        return json(200, body);
      },
    },
    {
      method: 'POST',
      path: /^\/api\/threads\/([^/]+)\/messages$/,
      handle: async (context) => {
        const request = await parseBody(context, SendMessageRequest);
        if (request.kind === 'rejected') return request.reply;
        const result = chat.send(context.id, request.value.text);
        switch (result.kind) {
          case 'started': {
            const body: SendMessageResponse = { generationId: result.generationId, userMessage: result.userMessage };
            return json(202, body);
          }
          case 'thread_not_found':
            return notFound('Thread');
          case 'busy':
            return failure('conflict', 'This thread is already generating a reply. Stop it first.');
          case 'no_provider':
            return failure('conflict', result.reason);
        }
      },
    },
    {
      method: 'POST',
      path: /^\/api\/threads\/([^/]+)\/stop$/,
      handle: async ({ id }) => {
        if (chat.getThread(id) === undefined) return notFound('Thread');
        return json(200, await chat.stop(id));
      },
    },
  ];
}
