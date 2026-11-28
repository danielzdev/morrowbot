import type { MessageReaction } from '@morrowbot/contracts';
import { useId, useRef, useState } from 'preact/hooks';
import { Icon } from '../../shared/ui/Icon.tsx';
import { QUICK_REACTIONS, userReacted } from './reactions.ts';

/**
 * One emoji on a message. The user's own on an agent reply is a button that takes it off again; anyone else's,
 * and the user's on a message they cannot change, is just labelled.
 */
function ReactionPill(props: { readonly reaction: MessageReaction; readonly agentName: string; readonly onToggle: ((emoji: string) => void) | null }) {
  const { reaction, onToggle } = props;
  if (reaction.actor === 'user' && onToggle !== null) {
    return (
      <button
        type="button"
        class="reaction-pill mine"
        aria-pressed="true"
        aria-label={`Your ${reaction.emoji} reaction`}
        title="Remove your reaction"
        onClick={() => { onToggle(reaction.emoji); }}
      >
        {reaction.emoji}
      </button>
    );
  }
  const who = reaction.actor === 'agent' ? props.agentName : 'You';
  return (
    <span class={`reaction-pill ${reaction.actor}`} role="img" aria-label={`${who} reacted ${reaction.emoji}`}>
      {reaction.emoji}
    </span>
  );
}

/** The pills under a message. `onToggle` is given only where the user may react (an agent's reply). */
export function ReactionPills(props: {
  readonly reactions: readonly MessageReaction[];
  readonly agentName: string;
  readonly onToggle: ((emoji: string) => void) | null;
}) {
  return (
    <>
      {props.reactions.map((reaction) => (
        <ReactionPill key={`${reaction.actor}:${reaction.emoji}`} reaction={reaction} agentName={props.agentName} onToggle={props.onToggle} />
      ))}
    </>
  );
}

/**
 * A small action beside a reply: "Add reaction" opens the quick picker. It shows while the message is hovered
 * or holds focus, and closes on Esc, a pick, or focus leaving it. Picking an emoji already on the reply removes it.
 */
export function ReactionPicker(props: { readonly reactions: readonly MessageReaction[]; readonly onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const close = (): void => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div
      class={`reaction-picker${open ? ' open' : ''}`}
      onFocusOut={(event) => {
        if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        class="icon-btn reaction-add"
        aria-label="Add reaction"
        title="Add reaction"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => { setOpen(!open); }}
      >
        <Icon name="smile" size={14} />
      </button>
      {open && (
        <div id={listId} class="reaction-choices" role="group" aria-label="Pick a reaction">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              class="reaction-choice"
              aria-pressed={userReacted(props.reactions, emoji)}
              aria-label={`React ${emoji}`}
              onClick={() => {
                props.onPick(emoji);
                close();
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
