import type { Thread } from '@morrowbot/contracts';
import type { RefObject } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { messageTime } from '../../shared/format.ts';
import { PLATFORM, shortcutLabel } from '../../shared/keys.ts';
import { focusRoving, handleRovingKey } from '../../shared/roving.ts';
import { Icon } from '../../shared/ui/Icon.tsx';
import { NameInput } from '../../shared/ui/NameInput.tsx';
import { Popover } from '../../shared/ui/Popover.tsx';
import { IconButton } from '../../shared/ui/Tooltip.tsx';
import { dotOf, type ThreadStatus } from './thread-status.ts';

export interface ChatSwitcherProps {
  readonly anchor: RefObject<HTMLElement | null>;
  readonly agentName: string;
  readonly threads: readonly Thread[];
  readonly mainId: string | null;
  readonly openThreadId: string | null;
  readonly statusOf: (threadId: string) => ThreadStatus;
  readonly onClose: () => void;
  readonly onNewChat: () => void;
  readonly onOpen: (threadId: string) => void;
  readonly onRename: (threadId: string, title: string) => void;
  readonly onDelete: (thread: Thread) => void;
}

const FILTER_ABOVE = 8;

/** The ⌄ list after the tabs: New chat, then every chat of this agent, newest first, with its time. Opening one adds its tab. */
export function ChatSwitcher(props: ChatSwitcherProps) {
  const [filter, setFilter] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const now = Date.now();
  const titleOf = (thread: Thread): string => (thread.id === props.mainId ? props.agentName : thread.title);
  const wanted = filter.trim().toLocaleLowerCase();
  const threads = props.threads.filter((thread) => wanted === '' || titleOf(thread).toLocaleLowerCase().includes(wanted));
  const items = (): HTMLElement[] => [...(list.current?.querySelectorAll<HTMLElement>('[data-roving]') ?? [])];
  const open = (threadId: string): void => {
    props.onClose();
    props.onOpen(threadId);
  };
  return (
    <Popover anchor={props.anchor} label={`${props.agentName} chats`} width={320} align="end" class="switcher" onClose={props.onClose}>
      <button
        type="button"
        class="switcher-new"
        data-autofocus={props.threads.length <= FILTER_ABOVE ? true : undefined}
        onClick={() => {
          props.onClose();
          props.onNewChat();
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && items().length > 0) {
            event.preventDefault();
            focusRoving(items(), 0);
          }
        }}
      >
        <Icon name="plus" />
        <span>New chat</span>
        <kbd>{shortcutLabel('new-chat', PLATFORM)}</kbd>
      </button>
      {props.threads.length > FILTER_ABOVE && (
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
              if (event.key === 'Enter' && threads[0] !== undefined) open(threads[0].id);
            }}
          />
        </div>
      )}
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
          const title = titleOf(thread);
          if (renaming === thread.id) {
            return (
              <div key={thread.id} class="switcher-row renaming" role="listitem">
                <NameInput
                  initial={thread.title}
                  label={`Rename ${title}`}
                  onDone={(name) => {
                    setRenaming(null);
                    if (name !== null) props.onRename(thread.id, name);
                  }}
                />
              </div>
            );
          }
          const main = thread.id === props.mainId;
          return (
            <div key={thread.id} class={`switcher-row ${thread.id === props.openThreadId ? 'selected' : ''}`} role="listitem">
              <button
                type="button"
                class="switcher-open"
                data-roving={title}
                tabIndex={index === 0 ? 0 : -1}
                aria-current={thread.id === props.openThreadId ? 'true' : undefined}
                title={main ? 'Main chat · Delete removes' : 'F2 renames · Delete removes'}
                onClick={() => {
                  open(thread.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'F2' && !main) setRenaming(thread.id);
                  if (event.key === 'Delete' || (event.key === 'Backspace' && (event.metaKey || event.ctrlKey))) props.onDelete(thread);
                }}
              >
                <span class={`status-dot ${dot?.tone ?? 'none'}`} role={dot === null ? undefined : 'img'} aria-label={dot?.label} />
                <span class="switcher-title">{title}</span>
                <span class="switcher-time">{messageTime(thread.updatedAt, now)}</span>
              </button>
              <span class="row-actions">
                {!main && <IconButton icon="pencil" label={`Rename ${title}`} tabIndex={-1} onClick={() => { setRenaming(thread.id); }} />}
                <IconButton icon="trash" label={`Delete ${title}`} tabIndex={-1} onClick={() => { props.onDelete(thread); }} />
              </span>
            </div>
          );
        })}
      </div>
    </Popover>
  );
}
