import type { Agent, Thread } from '@morrowbot/contracts';
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { Icon } from '../../shared/ui/Icon.tsx';
import { Menu, MenuButton, type MenuItem } from '../../shared/ui/Menu.tsx';
import { IconButton, Tooltip } from '../../shared/ui/Tooltip.tsx';
import { ChatSwitcher } from './ChatSwitcher.tsx';
import type { ThreadStatus } from './thread-status.ts';
import { ThreadTabs } from './ThreadTabs.tsx';
import { useTabs } from './use-tabs.ts';

export interface ThreadHeaderProps {
  readonly agent: Agent;
  readonly avatar: ComponentChildren;
  /** This agent's chats, newest first; empty while they load. */
  readonly threads: readonly Thread[];
  readonly threadsLoaded: boolean;
  readonly openThreadId: string | null;
  readonly statusOf: (threadId: string) => ThreadStatus;
  readonly unread: (threadId: string) => boolean;
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

interface TabMenu {
  readonly anchor: HTMLElement;
  readonly at: { readonly x: number; readonly y: number } | null;
  readonly items: readonly MenuItem[];
}

/** The top of the chat: the chat tabs, New chat (+), every chat (⌄) and the ⋯ menu for the chat on screen. */
export function ThreadHeader(props: ThreadHeaderProps) {
  const listButton = useRef<HTMLButtonElement>(null);
  const [switcher, setSwitcher] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Thread | null>(null);
  const [tabMenu, setTabMenu] = useState<TabMenu | null>(null);
  const { tabs, close, closeOthers } = useTabs(props.agent.id, props.threads, props.threadsLoaded, props.openThreadId, props.onOpen);
  const thread = props.threads.find(({ id }) => id === props.openThreadId);

  const actionsFor = (target: Thread, withSettings: boolean): readonly MenuItem[] => {
    const main = target.id === tabs.main?.id;
    return [
      ...(main ? [] : [{ kind: 'action', id: 'rename', label: 'Rename', icon: 'pencil', onSelect: () => { setRenaming(target.id); } } satisfies MenuItem]),
      { kind: 'action', id: 'copy', label: 'Copy chat as Markdown', icon: 'copy', onSelect: () => { props.onCopy(target.id); } },
      ...(main ? [] : [{ kind: 'action', id: 'close', label: 'Close tab', icon: 'close', onSelect: () => { close(target.id); } } satisfies MenuItem]),
      { kind: 'action', id: 'close-others', label: 'Close other tabs', onSelect: () => { closeOthers(target.id); } },
      ...(withSettings ? [{ kind: 'action', id: 'settings', label: 'Agent settings', icon: 'settings', onSelect: props.onAgentSettings } satisfies MenuItem] : []),
      { kind: 'separator', id: 'sep' },
      { kind: 'action', id: 'delete', label: 'Delete chat…', icon: 'trash', danger: true, onSelect: () => { setDeleting(target); } },
    ];
  };

  return (
    <header class="thread-header drag">
      {props.sidebarButton && <IconButton icon="sidebar" label="Show sidebar" shortcut="toggle-sidebar" onClick={props.onShowSidebar} />}
      <ThreadTabs
        agentName={props.agent.name}
        avatar={props.avatar}
        tabs={tabs}
        openThreadId={props.openThreadId}
        renamingId={renaming}
        statusOf={props.statusOf}
        unread={props.unread}
        onOpen={props.onOpen}
        onClose={close}
        onRename={setRenaming}
        onRenamed={(id, title) => {
          setRenaming(null);
          if (title !== null) props.onRename(id, title);
        }}
        onMenu={(target, anchor, at) => { setTabMenu({ anchor, at, items: actionsFor(target, false) }); }}
      />
      <IconButton icon="plus" label="New chat" shortcut="new-chat" onClick={props.onNewChat} />
      <Tooltip label="All chats">
        <button ref={listButton} type="button" class="icon-btn" aria-label="All chats" aria-haspopup="dialog" aria-expanded={switcher} onClick={() => { setSwitcher(!switcher); }}>
          <Icon name="chevron-down" />
        </button>
      </Tooltip>
      <span class="spacer" />
      {thread !== undefined && <MenuButton icon="more" label="Chat actions" items={() => actionsFor(thread, true)} />}
      {tabMenu !== null && <Menu key={`${String(tabMenu.at?.x)},${String(tabMenu.at?.y)}`} anchor={{ current: tabMenu.anchor }} at={tabMenu.at ?? undefined} label="Tab actions" align="start" items={tabMenu.items} onClose={() => { setTabMenu(null); }} />}
      {switcher && (
        <ChatSwitcher
          anchor={listButton}
          agentName={props.agent.name}
          threads={props.threads}
          mainId={tabs.main?.id ?? null}
          openThreadId={props.openThreadId}
          statusOf={props.statusOf}
          onClose={() => { setSwitcher(false); }}
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
          title={`Delete “${deleting.id === tabs.main?.id ? props.agent.name : deleting.title}”?`}
          body={<p>Its messages are removed. This can’t be undone.</p>}
          confirmLabel="Delete chat"
          tone="danger"
          onCancel={() => { setDeleting(null); }}
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
