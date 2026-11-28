import type { Thread } from '@morrowbot/contracts';
import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { messageTime } from '../../shared/format.ts';
import { PLATFORM, shortcutLabel } from '../../shared/keys.ts';
import { focusRoving, handleRovingKey } from '../../shared/roving.ts';
import type { Loadable } from '../../shared/store.ts';
import { Icon } from '../../shared/ui/Icon.tsx';
import { NameInput } from '../../shared/ui/NameInput.tsx';
import { Popover } from '../../shared/ui/Popover.tsx';
import { IconButton } from '../../shared/ui/Tooltip.tsx';
import { dotOf, type ThreadStatus } from './thread-status.ts';

export interface ChatSwitcherProps {
  readonly anchor: RefObject<HTMLElement | null>;
  readonly agentName: string;
  readonly threads: readonly Thread[];
  readonly archivedThreads: Loadable<readonly Thread[]> | undefined;
  readonly mainId: string | null;
  readonly openThreadId: string | null;
  readonly statusOf: (threadId: string) => ThreadStatus;
  readonly onClose: () => void;
  readonly onNewChat: () => void;
  readonly onOpen: (threadId: string) => void;
  readonly onRename: (threadId: string, title: string) => void;
  readonly onLoadArchived: () => void;
  readonly onArchive: (threadId: string) => void;
  readonly onRestore: (threadId: string) => void;
  readonly onDelete: (thread: Thread) => void;
}

const FILTER_ABOVE = 8;

/** The ⌄ list after the tabs: New chat, active chats newest first, and an Archived › submenu with Restore. */
export function ChatSwitcher(props: ChatSwitcherProps) {
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [filter, setFilter] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const archivedList = useRef<HTMLDivElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const archivedTrigger = useRef<HTMLButtonElement>(null);
  const previousView = useRef<'active' | 'archived'>('active');
  const onLoadArchived = useRef(props.onLoadArchived);
  onLoadArchived.current = props.onLoadArchived;

  useEffect(() => {
    onLoadArchived.current();
  }, []);

  useEffect(() => {
    if (previousView.current !== view) {
      previousView.current = view;
      if (view === 'archived') backButton.current?.focus();
      else archivedTrigger.current?.focus();
    }
  }, [view]);

  const now = Date.now();
  const titleOf = (thread: Thread): string => (thread.id === props.mainId ? props.agentName : thread.title);
  const wanted = filter.trim().toLocaleLowerCase();
  const threads = props.threads.filter((thread) => wanted === '' || titleOf(thread).toLocaleLowerCase().includes(wanted));
  const items = (): HTMLElement[] => [...(list.current?.querySelectorAll<HTMLElement>('[data-roving]') ?? [])];
  const archivedItems = (): HTMLElement[] => [...(archivedList.current?.querySelectorAll<HTMLElement>('[data-roving]') ?? [])];
  const open = (threadId: string): void => {
    props.onClose();
    props.onOpen(threadId);
  };
  const archiveRow = (threadId: string, index: number): void => {
    props.onArchive(threadId);
    requestAnimationFrame(() => {
      const remaining = items();
      const target = remaining[Math.min(index, remaining.length - 1)];
      if (target !== undefined) focusRoving(remaining, Math.min(index, remaining.length - 1));
      else archivedTrigger.current?.focus();
    });
  };
  const archived = props.archivedThreads;
  const archivedCount = archived?.kind === 'loaded' ? archived.value.length : null;

  return (
    <Popover
      anchor={props.anchor}
      label={view === 'archived' ? `${props.agentName} archived chats` : `${props.agentName} chats`}
      width={320}
      align="end"
      class="switcher"
      onClose={props.onClose}
      onKeyDown={(event) => {
        if (view === 'archived' && event.key === 'ArrowLeft') {
          event.preventDefault();
          setView('active');
        }
      }}
    >
      {view === 'archived' ? (
        <>
          <div class="switcher-archived-header">
            <button
              ref={backButton}
              type="button"
              class="switcher-back"
              aria-label="Back to active chats"
              onClick={() => {
                setView('active');
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' && archivedItems().length > 0) {
                  event.preventDefault();
                  focusRoving(archivedItems(), 0);
                }
              }}
            >
              <Icon name="chevron-left" />
              <span>Archived</span>
            </button>
          </div>
          <div
            ref={archivedList}
            class="switcher-list"
            role="list"
            aria-label="Archived chats"
            onKeyDown={(event) => {
              if (archivedList.current !== null) handleRovingKey(event, archivedList.current);
            }}
          >
            {(archived === undefined || archived.kind === 'loading') && <div class="switcher-empty">Loading archived chats…</div>}
            {archived?.kind === 'failed' && <div class="switcher-empty">{archived.message}</div>}
            {archived?.kind === 'loaded' && archived.value.length === 0 && <div class="switcher-empty">No archived chats.</div>}
            {archived?.kind === 'loaded' &&
              archived.value.map((thread, index) => (
                <div key={thread.id} class="switcher-row switcher-archived-row" role="listitem">
                  <span class="switcher-archived-info" title={thread.title}>
                    <span class="switcher-title">{thread.title}</span>
                    <span class="switcher-time">{messageTime(thread.archivedAt ?? thread.updatedAt, now)}</span>
                  </span>
                  <span class="switcher-archived-actions">
                    <button
                      type="button"
                      class="switcher-restore"
                      data-roving={thread.title}
                      tabIndex={index === 0 ? 0 : -1}
                      aria-label={`Restore ${thread.title}`}
                      title="Restore chat"
                      onClick={() => {
                        props.onClose();
                        props.onRestore(thread.id);
                      }}
                    >
                      <Icon name="restore" size={14} />
                      <span>Restore</span>
                    </button>
                    <IconButton icon="trash" label={`Delete ${thread.title}`} onClick={() => { props.onDelete(thread); }} />
                  </span>
                </div>
              ))}
          </div>
        </>
      ) : (
        <>
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
                      maxLength={200}
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
                    title={main ? 'Main chat · E archives · Delete removes' : 'F2 renames · E archives · Delete removes'}
                    onClick={() => {
                      open(thread.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'F2' && !main) setRenaming(thread.id);
                      if (event.key.toLowerCase() === 'e' && !event.metaKey && !event.ctrlKey && !event.altKey) {
                        event.preventDefault();
                        archiveRow(thread.id, index);
                      }
                      if (event.key === 'Delete' || (event.key === 'Backspace' && (event.metaKey || event.ctrlKey))) props.onDelete(thread);
                    }}
                  >
                    <span class={`status-dot ${dot?.tone ?? 'none'}`} role={dot === null ? undefined : 'img'} aria-label={dot?.label} />
                    <span class="switcher-title">{title}</span>
                    <span class="switcher-time">{messageTime(thread.updatedAt, now)}</span>
                  </button>
                  <span class="row-actions">
                    {!main && <IconButton icon="pencil" label={`Rename ${title}`} tabIndex={-1} onClick={() => { setRenaming(thread.id); }} />}
                    <IconButton icon="archive" label={`Archive ${title}`} tabIndex={-1} onClick={() => { archiveRow(thread.id, index); }} />
                    <IconButton icon="trash" label={`Delete ${title}`} tabIndex={-1} onClick={() => { props.onDelete(thread); }} />
                  </span>
                </div>
              );
            })}
          </div>
          <div class="switcher-footer">
            <button
              ref={archivedTrigger}
              type="button"
              class="switcher-archived-trigger"
              onClick={() => {
                setView('archived');
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  setView('archived');
                }
              }}
            >
              <Icon name="archive" />
              <span class="switcher-title">Archived</span>
              {archivedCount !== null && archivedCount > 0 && <span class="switcher-count">{archivedCount}</span>}
              <Icon name="chevron-right" />
            </button>
          </div>
        </>
      )}
    </Popover>
  );
}
