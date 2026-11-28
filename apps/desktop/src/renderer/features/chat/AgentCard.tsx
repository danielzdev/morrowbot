import { choicesOf, type ThreadCard, type UiBlock, type UiBlocks } from '@morrowbot/contracts';
import type { CardContext } from './ThreadCards.tsx';

type CustomBody = Extract<ThreadCard['body'], { kind: 'custom' }>;

/**
 * An agent's own card. Ori Bot draws the frame (the agent's avatar and name, "Agent card") and every block with its
 * own components, as plain text: a card cannot draw markup, links or images, and its buttons are never the primary
 * style that approvals use, so it cannot pass for Ori Bot's own cards.
 */
export function AgentCard(props: {
  readonly card: ThreadCard;
  readonly body: CustomBody;
  /** Why the choices wait (the reply is still running, a click is on its way, the host is away), or null. */
  readonly held: string | null;
  readonly ctx: CardContext;
}) {
  const { card, body, ctx } = props;
  const name = ctx.peers.name(card.agentId);
  return (
    <section class="agent-card" aria-label={`Card from ${name}`} data-card-id={card.id}>
      <header class="agent-card-frame">
        <span class="agent-card-avatar" aria-hidden="true">{ctx.peers.avatar(card.agentId, 16)}</span>
        <span class="agent-card-from">{name}</span>
        <span class="agent-card-kind">Agent card</span>
      </header>
      <div class="agent-card-body">
        {body.ui.blocks.map((block, index) => (
          <Block key={index} block={block} ui={body.ui} answer={body.answer} held={props.held} onChoose={(choiceId) => { ctx.onAct(card.id, { kind: 'choose', choiceId }); }} />
        ))}
      </div>
    </section>
  );
}

function Block(props: {
  readonly block: UiBlock;
  readonly ui: UiBlocks;
  readonly answer: string | null;
  readonly held: string | null;
  readonly onChoose: (choiceId: string) => void;
}) {
  const { block } = props;
  switch (block.kind) {
    case 'header':
      return <p class="ui-header">{block.text}</p>;
    case 'text':
      return <p class="ui-text">{block.text}</p>;
    case 'kv':
      return (
        <dl class="ui-kv">
          {block.items.map((item, index) => (
            <div key={index} class="ui-kv-row">
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      );
    case 'list': {
      const items = block.items.map((item, index) => <li key={index}>{item}</li>);
      return block.style === 'number' ? <ol class="ui-list">{items}</ol> : <ul class="ui-list">{items}</ul>;
    }
    case 'badges':
      return (
        <div class="ui-badges">
          {block.items.map((item, index) => (
            <span key={index} class={`ui-badge tone-${item.tone}`}>{item.text}</span>
          ))}
        </div>
      );
    case 'divider':
      return <hr class="ui-divider" />;
    case 'choices':
      return <Choices ui={props.ui} answer={props.answer} held={props.held} onChoose={props.onChoose} />;
  }
}

function Choices(props: { readonly ui: UiBlocks; readonly answer: string | null; readonly held: string | null; readonly onChoose: (choiceId: string) => void }) {
  const options = choicesOf(props.ui);
  const chosen = options.find(({ id }) => id === props.answer);
  if (chosen !== undefined) {
    return (
      <p class="ui-answer">
        You chose <span class="ui-answer-label">{chosen.label}</span>
      </p>
    );
  }
  return (
    <div class="ui-choices">
      <div class="card-actions" role="group" aria-label="Choices">
        {options.map((option) => (
          <button key={option.id} type="button" class="secondary" disabled={props.held !== null} onClick={() => { props.onChoose(option.id); }}>
            {option.label}
          </button>
        ))}
      </div>
      {props.held !== null && <span class="card-status">{props.held}</span>}
    </div>
  );
}
