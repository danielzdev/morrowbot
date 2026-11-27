import type { Thread } from '@morrowbot/contracts';
import type { RefObject } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { relativeTime } from '../../shared/format.ts';
import { PLATFORM, shortcutLabel } from '../../shared/keys.ts';
import { focusRoving, handleRovingKey } from '../../shared/roving.ts';
import { Icon } from '../../shared/ui/Icon.tsx';
import { Popover } from '../../shared/ui/Popover.tsx';
import { IconButton } from '../../shared/ui/Tooltip.tsx';
import { dotOf, type ThreadStatus } from './thread-status.ts';

export interface ChatSwitcherProps {
  readonly anchor: RefObject<HTMLElement | null>;
  readonly agentName: string;
  readonly threads: readonly Thread[];
  readonly openThreadId: string | null;
  readonly statusOf: (threadId: string) => ThreadStatus;
  readonly onClose: () => void;
  readonly onNewChat: () => void;
  readonly onOpen: (threadId: string) => void;
  readonly onRename: (threadId: string, title: string) => void;
  readonly onDelete: (thread: Thread) => void;
}

function RenameField(props: { readonly thread: Thread; readonly onDone: (title: string | null) => void }) {
  const [title, setTitle] = useState(props.thread.title);
  return (
    <input
      class="row-rename"
      aria-label={`Rename ${props.thread.title}`}
      value={title}
      ref={(input) => input?.focus()}
      onInput={(event) => {
        setTitle(event.currentTarget.value);
      }}
      onBlur={() => {
        props.onDone(title.trim() === '' || title.trim() === props.thread.title ? null : title.trim());
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') props.onDone(null);
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

/** The ▾ popover of the thread header (spec §3.3): filter, New chat, and this agent's chats, newest first. */
export function ChatSwitcher(props: ChatSwitcherProps) {
  const [filter, setFilter] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const now = Date.now();
  const wanted = filter.trim().toLocaleLowerCase();
  const threads = props.threads.filter((thread) => wanted === '' || thread.title.toLocaleLowerCase().includes(wanted));
  const items = (): HTMLElement[] => [...(list.current?.querySelectorAll<HTMLElement>('[data-roving]') ?? [])];
  return (
    <Popover anchor={props.anchor} label={`${props.agentName} chats`} width={320} class="switcher" onClose={props.onClose}>
      <div class="switcher-filter">
        <Icon name="search" />
        <input
          type="search"
          data-autofocus
          placeholder="Filter chats…"
          aria-label="Filter chats"
          value={filter}
          onInput={(event) => {
            setFilter(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && items().length > 0) {
              event.preventDefault();
              focusRoving(items(), 0);
            }
            if (event.key === 'Enter' && threads[0] !== undefined) {
              props.onClose();
              props.onOpen(threads[0].id);
            }
          }}
        />
      </div>
      <button
        type="button"
        class="switcher-new"
        onClick={() => {
          props.onClose();
          props.onNewChat();
        }}
      >
        <Icon name="plus" />
        <span>New chat</span>
        <kbd>{shortcutLabel('new-chat', PLATFORM)}</kbd>
      </button>
      <div
        ref={list}
        class="switcher-list"
        role="list"
        aria-label="Chats"
        onKeyDown={(event) => {
          if (list.current !== null) handleRovingKey(event, list.current);
        }}
      >
        {threads.length === 0 && <div class="switcher-empty">{props.threads.length === 0 ? 'No chats yet.' : 'No chats match.'}</div>}
        {threads.map((thread, index) => {
          const dot = dotOf(props.statusOf(thread.id));
          if (renaming === thread.id) {
            return (
              <div key={thread.id} class="switcher-row renaming" role="listitem">
                <RenameField
                  thread={thread}
                  onDone={(title) => {
                    setRenaming(null);
                    if (title !== null) props.onRename(thread.id, title);
                  }}
                />
              </div>
            );
          }
          return (
            <div key={thread.id} class={`switcher-row ${thread.id === props.openThreadId ? 'selected' : ''}`} role="listitem">
              <button
                type="button"
                class="switcher-open"
                data-roving={thread.title}
                tabIndex={index === 0 ? 0 : -1}
                aria-current={thread.id === props.openThreadId ? 'true' : undefined}
                title="F2 renames · Delete removes"
                onClick={() => {
                  props.onClose();
                  props.onOpen(thread.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'F2') setRenaming(thread.id);
                  if (event.key === 'Delete' || (event.key === 'Backspace' && (event.metaKey || event.ctrlKey))) props.onDelete(thread);
                }}
              >
                <span class={`status-dot ${dot?.tone ?? 'none'}`} role={dot === null ? undefined : 'img'} aria-label={dot?.label} />
                <span class="switcher-title">{thread.title}</span>
                <span class="switcher-time">{relativeTime(thread.updatedAt, now)}</span>
              </button>
              <span class="row-actions">
                <IconButton icon="pencil" label={`Rename ${thread.title}`} tabIndex={-1} onClick={() => { setRenaming(thread.id); }} />
                <IconButton icon="trash" label={`Delete ${thread.title}`} tabIndex={-1} onClick={() => { props.onDelete(thread); }} />
              </span>
            </div>
          );
        })}
      </div>
    </Popover>
  );
}
