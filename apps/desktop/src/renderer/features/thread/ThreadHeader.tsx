import type { Agent, Thread } from '@morrowbot/contracts';
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { Icon } from '../../shared/ui/Icon.tsx';
import { MenuButton } from '../../shared/ui/Menu.tsx';
import { IconButton } from '../../shared/ui/Tooltip.tsx';
import { ChatSwitcher } from './ChatSwitcher.tsx';
import { pillText, type ThreadStatus } from './thread-status.ts';

export interface ThreadHeaderProps {
  readonly agent: Agent;
  readonly avatar: ComponentChildren;
  /** This agent's chats, newest first; empty while they load. */
  readonly threads: readonly Thread[];
  readonly openThreadId: string | null;
  readonly statusOf: (threadId: string) => ThreadStatus;
  /** Shown when the sidebar is collapsed to its rail or is an overlay. */
  readonly sidebarButton: boolean;
  readonly onShowSidebar: () => void;
  readonly onAgentSettings: () => void;
  readonly onNewChat: () => void;
  readonly onOpen: (threadId: string) => void;
  readonly onRename: (threadId: string, title: string) => void;
  readonly onDelete: (threadId: string) => void;
  readonly onCopy: (threadId: string) => void;
}

/** The top of the chat (spec §3.3): avatar, agent / chat ▾, run state and the ⋯ menu. Replaces the tab strip. */
export function ThreadHeader(props: ThreadHeaderProps) {
  const switcherButton = useRef<HTMLButtonElement>(null);
  const [switcher, setSwitcher] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState<Thread | null>(null);
  const thread = props.threads.find(({ id }) => id === props.openThreadId);
  const pill = thread === undefined ? null : pillText(props.statusOf(thread.id));
  return (
    <header class="thread-header drag">
      {props.sidebarButton && <IconButton icon="sidebar" label="Show sidebar" shortcut="toggle-sidebar" onClick={props.onShowSidebar} />}
      <div class="crumbs">
        <span class="crumb-avatar">{props.avatar}</span>
        <button type="button" class="crumb-agent" title="Agent settings" onClick={props.onAgentSettings}>
          {props.agent.name}
        </button>
        {thread !== undefined && <span class="crumb-sep" aria-hidden="true">/</span>}
        {thread !== undefined &&
          (renaming ? (
            <input
              class="crumb-rename"
              aria-label="Chat name"
              defaultValue={thread.title}
              ref={(input) => input?.focus()}
              onBlur={(event) => {
                const title = event.currentTarget.value.trim();
                setRenaming(false);
                if (title !== '' && title !== thread.title) props.onRename(thread.id, title);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Escape') setRenaming(false);
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
          ) : (
            <button
              ref={switcherButton}
              type="button"
              class="crumb-chat"
              aria-haspopup="dialog"
              aria-expanded={switcher}
              title="Switch chats · double-click to rename"
              onClick={() => {
                setSwitcher(!switcher);
              }}
              onDblClick={() => {
                setSwitcher(false);
                setRenaming(true);
              }}
            >
              <span class="crumb-title">{thread.title}</span>
              <Icon name="chevron-down" size={14} />
            </button>
          ))}
      </div>
      <span class="spacer" />
      {pill !== null && <span class={`run-pill ${props.statusOf(thread?.id ?? '')}`}>{pill}</span>}
      {thread !== undefined && (
        <MenuButton
          icon="more"
          label="Chat actions"
          items={() => [
            { kind: 'action', id: 'rename', label: 'Rename', icon: 'pencil', onSelect: () => { setRenaming(true); } },
            { kind: 'action', id: 'new', label: 'New chat', icon: 'plus', shortcut: 'new-chat', onSelect: props.onNewChat },
            { kind: 'action', id: 'copy', label: 'Copy chat as Markdown', icon: 'copy', onSelect: () => { props.onCopy(thread.id); } },
            { kind: 'action', id: 'settings', label: 'Agent settings', icon: 'settings', onSelect: props.onAgentSettings },
            { kind: 'separator', id: 'sep' },
            { kind: 'action', id: 'delete', label: 'Delete chat…', icon: 'trash', danger: true, onSelect: () => { setDeleting(thread); } },
          ]}
        />
      )}
      {switcher && (
        <ChatSwitcher
          anchor={switcherButton}
          agentName={props.agent.name}
          threads={props.threads}
          openThreadId={props.openThreadId}
          statusOf={props.statusOf}
          onClose={() => {
            setSwitcher(false);
          }}
          onNewChat={props.onNewChat}
          onOpen={props.onOpen}
          onRename={props.onRename}
          onDelete={(target) => {
            setSwitcher(false);
            setDeleting(target);
          }}
        />
      )}
      {deleting !== null && (
        <ConfirmDialog
          title={`Delete “${deleting.title}”?`}
          body={<p>Its messages are removed. This can’t be undone.</p>}
          confirmLabel="Delete chat"
          tone="danger"
          onCancel={() => {
            setDeleting(null);
          }}
          onConfirm={() => {
            const id = deleting.id;
            setDeleting(null);
            props.onDelete(id);
          }}
        />
      )}
    </header>
  );
}
