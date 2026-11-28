import type { CardBody, ThreadCard } from '@morrowbot/contracts';
import { runningTurn, type ReplyToolAnswer, type TurnGrant } from './reactions.ts';
import type { ChatCore } from './turn.ts';

/** The most cards one turn may put in the chat, so a looping agent cannot flood it. */
export const MAX_CARDS_PER_TURN = 3;

export type StageAnswer = { readonly kind: 'staged'; readonly card: ThreadCard } | Extract<ReplyToolAnswer, { kind: 'refused' }>;

/**
 * `propose_card`: saves the card on the running turn `grant` stands for and shows it live. It joins the turn's reply
 * when that is saved (see `settle` and `steerDelivered`), and is dropped with a turn that saves none.
 */
export function stageCard(core: ChatCore, grant: TurnGrant, body: CardBody): StageAnswer {
  const turn = runningTurn(core, grant);
  if (turn === undefined) return { kind: 'refused', reason: 'This turn has ended.' };
  const { store, newId, now } = core.options;
  if (store.cards.countOpen(turn.generationId) >= MAX_CARDS_PER_TURN) {
    return { kind: 'refused', reason: `A reply holds at most ${String(MAX_CARDS_PER_TURN)} cards.` };
  }
  const card: ThreadCard = {
    id: newId(),
    threadId: turn.threadId,
    generationId: turn.generationId,
    messageId: null,
    agentId: turn.agentId,
    createdAt: now(),
    revision: 0,
    body,
  };
  store.cards.insert(card);
  publishCard(core, card);
  return { kind: 'staged', card };
}

/** Tells the chat's windows about the card's newest copy. */
export function publishCard(core: ChatCore, card: ThreadCard): void {
  if (core.closed || core.deletingThreads.has(card.threadId)) return;
  core.events.publish({ kind: 'card.changed', threadId: card.threadId, card });
}
