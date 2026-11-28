import type { Agent, Thread } from '@morrowbot/contracts';
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { ariaShortcut, PLATFORM } from '../../shared/keys.ts';
import type { Loadable } from '../../shared/store.ts';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { Icon } from '../../shared/ui/Icon.tsx';
import { Menu, type MenuItem } from '../../shared/ui/Menu.tsx';
import { IconButton, Tooltip } from '../../shared/ui/Tooltip.tsx';
import { ChatSwitcher } from './ChatSwitcher.tsx';
import type { ThreadStatus } from './thread-status.ts';
import { ThreadTabs } from './ThreadTabs.tsx';
import { useTabs } from './use-tabs.ts';

export interface ThreadHeaderProps {
  readonly agent: Agent;
  readonly avatar: ComponentChildren;
  /** This agent's active chats, newest first; empty while they load. */
  readonly threads: readonly Thread[];
  readonly threadsLoaded: boolean;
  /** This agent's archived chats, most recently archived first; undefined until opened. */
  readonly archivedThreads: Loadable<readonly Thread[]> | undefined;
  readonly openThreadId: string | null;
  readonly statusOf: (threadId: string) => ThreadStatus;
  readonly unread: (threadId: string) => boolean;
  /** Shown when the sidebar is collapsed to its rail or is an overlay. */
  readonly sidebarButton: boolean;
  readonly onShowSidebar: () => void;
  readonly onNewChat: () => void;
  readonly onOpen: (threadId: string) => void;
  readonly onRename: (threadId: string, title: string) => void;
  readonly onLoadArchived: () => void;
  readonly onArchive: (threadId: string) => void;
  readonly onRestore: (threadId: string) => void;
  readonly onDelete: (threadId: string) => void;
  readonly onCopy: (threadId: string) => void;
  /** The Agent Inspector toggle (⌘I); `inspectorToggle` marks it so the overlay drawer ignores presses on it. */
  readonly inspectorOpen: boolean;
  readonly inspectorToggle: string;
  readonly onToggleInspector: () => void;
}

interface TabMenu {
  readonly threadId: string;
  readonly anchor: HTMLElement;
  readonly at: { readonly x: number; readonly y: number } | null;
  readonly items: readonly MenuItem[];
}

/** The top of the chat: the chat tabs, New chat (+) and every chat (⌄). */
export function ThreadHeader(props: ThreadHeaderProps) {
  const listButton = useRef<HTMLButtonElement>(null);
  const [switcher, setSwitcher] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Thread | null>(null);
  const [tabMenu, setTabMenu] = useState<TabMenu | null>(null);
  const header = useRef<HTMLElement>(null);
  const { tabs, close: closeTab, closeOthers } = useTabs(props.agent.id, props.threads, props.threadsLoaded, props.openThreadId, props.onOpen);
  const close = (threadId: string): void => {
    const hadFocus = header.current?.contains(document.activeElement) === true || document.activeElement === document.body;
    closeTab(threadId);
    if (hadFocus) requestAnimationFrame(() => header.current?.querySelector<HTMLElement>('.tab.active .tab-open')?.focus());
  };
  const actionsFor = (target: Thread): readonly MenuItem[] => {
    const main = target.id === tabs.main?.id;
    return [
      ...(main ? [] : [{ kind: 'action', id: 'rename', label: 'Rename', icon: 'pencil', onSelect: () => { setRenaming(target.id); } } satisfies MenuItem]),
      { kind: 'action', id: 'copy', label: 'Copy chat as Markdown', icon: 'copy', onSelect: () => { props.onCopy(target.id); } },
      ...(main ? [] : [{ kind: 'action', id: 'close', label: 'Close tab', icon: 'close', onSelect: () => { close(target.id); } } satisfies MenuItem]),
      { kind: 'action', id: 'close-others', label: 'Close other tabs', onSelect: () => { closeOthers(target.id); } },
      { kind: 'separator', id: 'sep' },
      { kind: 'action', id: 'archive', label: 'Archive chat', icon: 'archive', onSelect: () => { props.onArchive(target.id); } },
      { kind: 'action', id: 'delete', label: 'Delete chat…', icon: 'trash', danger: true, onSelect: () => { setDeleting(target); } },
    ];
  };

  return (
    <header ref={header} class="thread-header drag">
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
        onMenu={(target, anchor, at) => { setTabMenu({ threadId: target.id, anchor, at, items: actionsFor(target) }); }}
      />
      <IconButton icon="plus" label="New chat" shortcut="new-chat" onClick={props.onNewChat} />
      <Tooltip label="All chats">
        <button ref={listButton} type="button" class="icon-btn" aria-label="All chats" aria-haspopup="dialog" aria-expanded={switcher} onClick={() => { setSwitcher(!switcher); }}>
          <Icon name="chevron-down" />
        </button>
      </Tooltip>
      <span class="spacer" />
      <Tooltip label="Agent Inspector" shortcut="inspector">
        <button
          type="button"
          class={`icon-btn${props.inspectorOpen ? ' active' : ''}`}
          aria-label="Agent Inspector"
          aria-pressed={props.inspectorOpen}
          aria-keyshortcuts={ariaShortcut('inspector', PLATFORM)}
          {...{ [props.inspectorToggle]: '' }}
          onClick={props.onToggleInspector}
        >
          <Icon name="inspector" />
        </button>
      </Tooltip>
      {tabMenu !== null && <Menu key={`${tabMenu.threadId}-${tabMenu.at === null ? 'key' : `${String(tabMenu.at.x)},${String(tabMenu.at.y)}`}`} anchor={{ current: tabMenu.anchor }} at={tabMenu.at ?? undefined} label="Tab actions" align="start" items={tabMenu.items} onClose={() => { setTabMenu(null); }} />}
      {switcher && (
        <ChatSwitcher
          key={props.agent.id}
          anchor={listButton}
          agentName={props.agent.name}
          threads={props.threads}
          archivedThreads={props.archivedThreads}
          mainId={tabs.main?.id ?? null}
          openThreadId={props.openThreadId}
          statusOf={props.statusOf}
          onClose={() => { setSwitcher(false); }}
          onNewChat={props.onNewChat}
          onOpen={props.onOpen}
          onRename={props.onRename}
          onLoadArchived={props.onLoadArchived}
          onArchive={props.onArchive}
          onRestore={props.onRestore}
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
