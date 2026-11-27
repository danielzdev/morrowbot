import type { ComponentChildren } from 'preact';
import { relativeTime } from '../../shared/format.ts';
import { MenuButton, type MenuItem } from '../../shared/ui/Menu.tsx';
import { IconButton, Tooltip } from '../../shared/ui/Tooltip.tsx';
import { RowRename } from './RowRename.tsx';
import type { AgentEntry, AgentStatus } from './sidebar-groups.ts';

/** The one status a row shows on its right (spec §3.1), as words; null shows nothing. */
export function statusText(status: AgentStatus, now: number): { readonly text: string; readonly tone: 'warn' | 'muted' | 'meta' | 'unread' } | null {
  switch (status.kind) {
    case 'needs-approval':
      return { text: 'Needs approval', tone: 'warn' };
    case 'needs-you':
      return { text: 'Needs you', tone: 'warn' };
    case 'working':
      return { text: 'Working', tone: 'muted' };
    case 'queued':
      return { text: 'Queued', tone: 'muted' };
    case 'unread':
      return { text: 'New reply', tone: 'unread' };
    case 'known':
      return { text: relativeTime(status.lastActive, now), tone: 'meta' };
    case 'unknown':
      return null;
  }
}

export interface AgentRowProps {
  readonly entry: AgentEntry;
  readonly avatar: ComponentChildren;
  readonly selected: boolean;
  readonly tabbable: boolean;
  readonly rail: boolean;
  readonly renaming: boolean;
  readonly now: number;
  readonly onOpen: (row: HTMLElement) => void;
  readonly onFocus: () => void;
  readonly onNewChat: () => void;
  readonly menu: () => readonly MenuItem[];
  readonly onRenamed: (name: string | null) => void;
}

/** One agent in the sidebar: avatar, name and one status; hover or focus shows New chat and ⋯. */
export function AgentRow(props: AgentRowProps) {
  const { agent, status } = props.entry;
  const shown = statusText(status, props.now);
  const describedBy = `agent-status-${agent.id}`;
  const main = (
    <button
      type="button"
      class="agent-main"
      data-agent={agent.id}
      tabIndex={props.tabbable ? 0 : -1}
      aria-current={props.selected ? 'true' : undefined}
      aria-label={props.rail ? agent.name : undefined}
      aria-describedby={shown === null ? undefined : describedBy}
      onFocus={props.onFocus}
      onClick={(event) => {
        props.onOpen(event.currentTarget);
      }}
    >
      {props.avatar}
      {!props.rail && <span class="agent-name">{agent.name}</span>}
      {shown !== null &&
        (shown.tone === 'unread' ? (
          <span id={describedBy} class="unread-dot" role="img" aria-label={shown.text} />
        ) : (
          <span id={describedBy} class={`agent-status ${shown.tone} ${props.rail ? 'visually-hidden' : ''}`}>
            {shown.text}
          </span>
        ))}
      {props.rail && shown !== null && shown.tone === 'warn' && <span class="rail-dot warn" aria-hidden="true" />}
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
        <RowRename agent={agent} onDone={props.onRenamed} />
      </div>
    );
  }
  const actionTab = props.tabbable ? 0 : -1;
  return (
    <div class={`agent-row ${props.selected ? 'selected' : ''}`}>
      {main}
      <span class="row-actions">
        <IconButton icon="plus" label={`New chat with ${agent.name}`} tabIndex={actionTab} onClick={props.onNewChat} />
        <MenuButton icon="more" label={`${agent.name} actions`} tabIndex={actionTab} items={props.menu} />
      </span>
    </div>
  );
}
