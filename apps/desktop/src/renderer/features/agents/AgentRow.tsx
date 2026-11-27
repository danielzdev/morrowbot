import type { ComponentChildren } from 'preact';
import { messageTime } from '../../shared/format.ts';
import { Tooltip } from '../../shared/ui/Tooltip.tsx';
import { NameInput } from '../../shared/ui/NameInput.tsx';
import type { AgentEntry, AgentStatus } from './sidebar-groups.ts';

/** A status that takes the place of the message preview (spec §3.1); null shows the preview. */
export function statusText(status: AgentStatus): { readonly text: string; readonly tone: 'warn' | 'muted' } | null {
  switch (status.kind) {
    case 'needs-approval':
      return { text: 'Needs approval', tone: 'warn' };
    case 'needs-you':
      return { text: status.reason === 'unbound' ? 'Needs you: choose a provider' : 'Needs you', tone: 'warn' };
    case 'working':
      return { text: 'Working…', tone: 'muted' };
    case 'queued':
      return { text: 'Queued', tone: 'muted' };
    case 'unread':
    case 'idle':
      return null;
  }
}

const PREVIEW_CHARS = 160;

/** One line of an already redacted preview: whitespace collapsed, at most 160 characters. */
export function shortPreview(redacted: string): string {
  const line = redacted.replaceAll(/\s+/g, ' ').trim();
  return line.length <= PREVIEW_CHARS ? line : `${line.slice(0, PREVIEW_CHARS).trimEnd()}…`;
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

/** One agent: a large avatar, then name, role and time over the last message or a status. Right-click, the menu key or ⇧F10 opens its actions. */
export function AgentRow(props: AgentRowProps) {
  const { agent, status, lastMessage } = props.entry;
  const shown = statusText(status);
  const unread = status.kind === 'unread';
  const role = agent.description.split('\n')[0]?.trim() ?? '';
  const preview = lastMessage === null ? null : `${lastMessage.kind === 'user' ? 'You: ' : ''}${shortPreview(props.redact(lastMessage.preview))}`;
  const main = (
    <button
      type="button"
      class="agent-main"
      data-agent={agent.id}
      tabIndex={props.tabbable ? 0 : -1}
      aria-current={props.selected ? 'true' : undefined}
      aria-label={props.rail ? (shown === null ? agent.name : `${agent.name}, ${shown.text}`) : undefined}
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
            {lastMessage !== null && <span class="agent-time">{messageTime(lastMessage.at, props.now)}</span>}
          </span>
          <span class="agent-line">
            {shown !== null ? (
              <span class={`agent-preview ${shown.tone}`}>{shown.text}</span>
            ) : (
              <span class={`agent-preview ${preview === null ? 'empty' : ''}`}>{preview ?? 'No messages yet'}</span>
            )}
            {unread && <span class="unread-dot" role="img" aria-label="New reply" />}
          </span>
        </span>
      )}
      {props.rail && (unread || shown?.tone === 'warn') && <span class={`rail-dot ${unread ? 'unread' : 'warn'}`} aria-hidden="true" />}
    </button>
  );
  if (props.rail) {
    return (
      <div class={`agent-row rail ${props.selected ? 'selected' : ''}`}>
        <Tooltip label={shown === null ? agent.name : `${agent.name} · ${shown.text}`} side="right">
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
