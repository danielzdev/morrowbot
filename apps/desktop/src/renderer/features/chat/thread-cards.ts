import type { ThreadCard } from '@morrowbot/contracts';

/** `cards` with `card` in place of an older copy of it, or added last; an older copy than the one shown is ignored. */
export function withCard(cards: readonly ThreadCard[], card: ThreadCard): readonly ThreadCard[] {
  const shown = cards.find(({ id }) => id === card.id);
  if (shown === undefined) return [...cards, card];
  if (shown.revision > card.revision || (shown.revision === card.revision && shown.messageId !== null)) return cards;
  return cards.map((each) => (each.id === card.id ? card : each));
}

/**
 * The turn's cards once it ended as the host saved it: on its reply `messageId`, or gone with a turn that saved
 * none (the host does the same in one transaction with the reply).
 */
export function settleCards(cards: readonly ThreadCard[], generationId: string, messageId: string | null): readonly ThreadCard[] {
  return settle(cards, (card) => card.generationId === generationId && card.messageId === null, messageId);
}

/**
 * The cards a steered turn had staged when the host saved its `segment`. A card staged after the steer stays with
 * the turn: a snapshot read during a steer can already hold it while the `steered` event is still to replay.
 */
export function settleSteered(cards: readonly ThreadCard[], generationId: string, segment: { readonly id: string; readonly createdAt: string }): readonly ThreadCard[] {
  return settle(cards, (card) => card.generationId === generationId && card.messageId === null && card.createdAt <= segment.createdAt, segment.id);
}

function settle(cards: readonly ThreadCard[], open: (card: ThreadCard) => boolean, messageId: string | null): readonly ThreadCard[] {
  if (!cards.some(open)) return cards;
  return messageId === null ? cards.filter((card) => !open(card)) : cards.map((card) => (open(card) ? { ...card, messageId } : card));
}

/** The cards of each saved reply, oldest first. */
export function cardsByMessage(cards: readonly ThreadCard[]): ReadonlyMap<string, readonly ThreadCard[]> {
  const byMessage = new Map<string, ThreadCard[]>();
  for (const card of cards) {
    if (card.messageId === null) continue;
    byMessage.set(card.messageId, [...(byMessage.get(card.messageId) ?? []), card]);
  }
  return byMessage;
}

/** The cards the running turn `generationId` proposed so far. */
export function stagedCards(cards: readonly ThreadCard[], generationId: string): readonly ThreadCard[] {
  return cards.filter((card) => card.generationId === generationId && card.messageId === null);
}
