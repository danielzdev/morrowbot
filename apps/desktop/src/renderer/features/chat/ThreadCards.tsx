import type { CardAction, ThreadCard } from '@morrowbot/contracts';
import type { PeerDirectory } from './AgentExchange.tsx';
import { AgentCard } from './AgentCard.tsx';
import { PluginCard, SettingCard } from './HostCards.tsx';

/** What a card needs from the chat, which stays the same while a reply streams. */
export interface CardContext {
  readonly peers: PeerDirectory;
  /** The server's owner: only their click acts on Ori Bot's own cards. */
  readonly owner: boolean;
  readonly onAct: (cardId: string, action: CardAction) => void;
  /** Extensions, at the plugin; null where Extensions is not open to this user. */
  readonly onOpenPlugin: ((pluginId: string) => void) | null;
}

const STAGED = 'Ready when the reply is done';
const SENDING = 'Sending…';
const OFFLINE = 'Waiting for the connection';

/** The cards of one reply (or of the running turn, `staged`), in the order the agent proposed them. */
export function ThreadCards(props: {
  readonly cards: readonly ThreadCard[];
  readonly staged: boolean;
  readonly acting: readonly string[];
  readonly offline: boolean;
  readonly ctx: CardContext;
}) {
  if (props.cards.length === 0) return null;
  return (
    <div class="thread-cards">
      {props.cards.map((card) => {
        const held = props.staged ? STAGED : props.acting.includes(card.id) ? SENDING : props.offline ? OFFLINE : null;
        const { body } = card;
        switch (body.kind) {
          case 'custom':
            return <AgentCard key={card.id} card={card} body={body} held={held} ctx={props.ctx} />;
          case 'plugin':
            return <PluginCard key={card.id} card={card} body={body} held={held} ctx={props.ctx} />;
          case 'setting':
            return <SettingCard key={card.id} card={card} body={body} held={held} ctx={props.ctx} />;
        }
      })}
    </div>
  );
}
