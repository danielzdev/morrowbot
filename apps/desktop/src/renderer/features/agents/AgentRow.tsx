import type { ComponentChildren } from 'preact';
import { messageTime } from '../../shared/format.ts';
import { Icon } from '../../shared/ui/Icon.tsx';
import { Tooltip } from '../../shared/ui/Tooltip.tsx';
import { NameInput } from '../../shared/ui/NameInput.tsx';
import { markLabel, markOf, type RowMark } from './row-mark.ts';
import type { AgentEntry } from './sidebar-groups.ts';

/** Three dots that bounce in turn while the agent works; still when queued or when motion is reduced. */
function WorkingDots(props: { readonly moving: boolean; readonly label: string }) {
  return (
    <span class={`working-dots ${props.moving ? 'moving' : ''}`} role="img" aria-label={props.label}>
      <i />
      <i />
      <i />
    </span>
  );
}

/** The row's mark: working dots, a needs-you badge or the unread dot. The rail shows a badge as a dot on the avatar. */
function Mark(props: { readonly mark: RowMark; readonly rail: boolean }) {
  const { mark } = props;
  switch (mark.kind) {
    case 'none':
      return null;
    case 'unread':
      return <span class="unread-dot" role="img" aria-label={mark.label} />;
    case 'dots':
      return <WorkingDots moving={mark.moving} label={mark.label} />;
    case 'badge':
      return props.rail ? (
        <span class={`rail-dot ${mark.tone}`} role="img" aria-label={mark.label} />
      ) : (
        <span class={`agent-badge ${mark.tone}`} title={mark.label}>
          <span aria-hidden="true">{mark.text}</span>
          <span class="visually-hidden">{mark.label}</span>
        </span>
      );
  }
}

const PREVIEW_CHARS = 160;
const LETTERS = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** One line of an already redacted preview: whitespace collapsed, at most 160 letters (emoji kept whole). */
export function shortPreview(redacted: string): string {
  const line = redacted.replaceAll(/\s+/g, ' ').trim();
  const letters = Array.from(LETTERS.segment(line), ({ segment }) => segment);
  return letters.length <= PREVIEW_CHARS ? line : `${letters.slice(0, PREVIEW_CHARS).join('').trimEnd()}…`;
}

export interface AgentRowProps {
  readonly entry: AgentEntry;
  readonly avatar: ComponentChildren;
  readonly selected: boolean;
  readonly tabbable: boolean;
  readonly rail: boolean;
  readonly renaming: boolean;
  readonly now: number;
  /** Makes message text safe to show (spec §9.1). */
  readonly redact: (text: string) => string;
  readonly onOpen: (row: HTMLElement) => void;
  readonly onFocus: () => void;
  /** Opens the agent's menu at a right-click point, or beside the row from the keyboard (null). */
  readonly onMenu: (row: HTMLElement, at: { readonly x: number; readonly y: number } | null) => void;
  readonly onRenamed: (name: string | null) => void;
}

/**
 * One agent: a large avatar, then name, role and time over the last message and its mark (working dots
 * or a needs-you badge). Right-click, the menu key or ⇧F10 opens its actions.
 */
export function AgentRow(props: AgentRowProps) {
  const { agent, status, notify, lastMessage } = props.entry;
  const mark = markOf(status);
  const muted = notify === 'muted';
  const words = [markLabel(mark), muted ? 'Muted' : null].filter((part) => part !== null);
  const said = words.length === 0 ? null : words.join(', ');
  const unread = mark.kind === 'unread';
  const role = agent.description.split('\n')[0]?.trim() ?? '';
  const preview = lastMessage === null ? null : `${lastMessage.kind === 'user' ? 'You: ' : ''}${shortPreview(props.redact(lastMessage.preview))}`;
  const main = (
    <button
      type="button"
      class="agent-main"
      data-agent={agent.id}
      tabIndex={props.tabbable ? 0 : -1}
      aria-current={props.selected ? 'true' : undefined}
      aria-label={props.rail ? (said === null ? agent.name : `${agent.name}, ${said}`) : undefined}
      onFocus={props.onFocus}
      onClick={(event) => {
        props.onOpen(event.currentTarget);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        props.onMenu(event.currentTarget, event.button === 2 ? { x: event.clientX, y: event.clientY } : null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'F10' && event.shiftKey) {
          event.preventDefault();
          props.onMenu(event.currentTarget, null);
        }
      }}
    >
      {props.avatar}
      {!props.rail && (
        <span class="agent-text">
          <span class="agent-line">
            <span class="agent-name">{agent.name}</span>
            {role !== '' && <span class="agent-role">{role}</span>}
            {muted && (
              <span class="agent-muted" title="Muted">
                <Icon name="bell-off" size={12} />
                <span class="visually-hidden">Muted</span>
              </span>
            )}
            {lastMessage !== null && <span class="agent-time">{messageTime(lastMessage.at, props.now)}</span>}
          </span>
          <span class="agent-line">
            <span class={`agent-preview ${preview === null ? 'empty' : ''}`}>{preview ?? 'No messages yet'}</span>
            <Mark mark={mark} rail={false} />
          </span>
        </span>
      )}
      {props.rail && mark.kind !== 'none' && (
        <span class="rail-mark" aria-hidden="true">
          <Mark mark={mark} rail />
        </span>
      )}
    </button>
  );
  if (props.rail) {
    return (
      <div class={`agent-row rail ${props.selected ? 'selected' : ''}`}>
        <Tooltip label={said === null ? agent.name : `${agent.name} · ${said}`} side="right">
          {main}
        </Tooltip>
      </div>
    );
  }
  if (props.renaming) {
    return (
      <div class="agent-row renaming">
        {props.avatar}
        <NameInput initial={agent.name} maxLength={200} label={`Rename ${agent.name}`} onDone={props.onRenamed} />
      </div>
    );
  }
  return <div class={`agent-row ${props.selected ? 'selected' : ''} ${unread ? 'unread' : ''}`}>{main}</div>;
}
