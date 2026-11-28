import { CardAction, type ThreadCardList } from '@morrowbot/contracts';
import { initiatorOf } from './access.ts';
import { refusal } from './admit-reply.ts';
import type { ApiServices } from './ports.ts';
import { failure, json, notFound, type Reply } from './reply.ts';
import { parseBody, type Route } from './route.ts';

/** Thread cards (`/api/ui/v1`): kept apart from messages, so a client that draws no cards still reads every chat. */
export function cardRoutes({ cards, chat }: ApiServices): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/ui/v1/threads/:id/cards',
      access: { kind: 'thread', need: 'view' },
      handle: ({ params }) => {
        const threadId = params.get('id');
        if (chat.getThread(threadId) === undefined) return notFound('Thread');
        const body: ThreadCardList = { cards: cards.list(threadId) };
        return json(200, body);
      },
    },
    {
      method: 'POST',
      path: '/api/ui/v1/threads/:id/cards/:cardId/act',
      access: { kind: 'thread', need: 'chat' },
      bodyBytes: 4096,
      handle: async (context) => {
        const request = await parseBody(context, CardAction);
        if (request.kind === 'rejected') return request.reply;
        const threadId = context.params.get('id');
        let notSent: Reply = failure('internal', 'The choice was not sent');
        const answer = await cards.act(threadId, context.params.get('cardId'), request.value, { owner: context.viewer.kind === 'owner' }, async (text) => {
          const sent = await chat.send(threadId, text, [], { kind: 'auto' }, initiatorOf(context.viewer));
          switch (sent.kind) {
            case 'started':
            case 'queued':
              return true;
            case 'thread_not_found':
            case 'busy':
            case 'no_provider':
            case 'provider_unavailable':
            case 'binding_changed':
            case 'session_choice_required':
            case 'not_continuable':
            case 'attachments_missing':
              notSent = refusal(sent);
              return false;
          }
        });
        switch (answer.kind) {
          case 'done':
            return json(200, answer.card);
          case 'not_found':
            return notFound('Card');
          case 'not_sent':
            return notSent;
          case 'forbidden':
            return failure('forbidden', answer.reason);
          case 'conflict':
            return failure('conflict', answer.reason);
          case 'invalid':
            return failure('invalid_request', answer.reason);
        }
      },
    },
  ];
}
