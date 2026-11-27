import type { Thread } from '@morrowbot/contracts';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Icon } from '../../shared/ui/Icon.tsx';
import { NameInput } from '../../shared/ui/NameInput.tsx';
import type { Tabs } from './tabs.ts';
import { dotOf, type ThreadStatus } from './thread-status.ts';

export interface ThreadTabsProps {
  readonly agentName: string;
  readonly avatar: ComponentChildren;
  readonly tabs: Tabs;
  readonly openThreadId: string | null;
  readonly renamingId: string | null;
  readonly statusOf: (threadId: string) => ThreadStatus;
  readonly unread: (threadId: string) => boolean;
  readonly onOpen: (threadId: string) => void;
  readonly onClose: (threadId: string) => void;
  readonly onRename: (threadId: string | null) => void;
  readonly onRenamed: (threadId: string, title: string | null) => void;
  /** Opens a tab's menu at a right-click point, or beside the tab from the keyboard (null). */
  readonly onMenu: (thread: Thread, tab: HTMLElement, at: { readonly x: number; readonly y: number } | null) => void;
}

/** What a tab shows at its end: a spinner while working, a dot for queued, approval, failure or a new reply. */
function Marker(props: { readonly status: ThreadStatus; readonly unread: boolean }) {
  if (props.status === 'working') return <span class="tab-spinner" role="img" aria-label="Working" />;
  const dot = dotOf(props.status) ?? (props.unread ? { tone: 'accent', label: 'New reply' } : null);
  return dot === null ? null : <span class={`status-dot ${dot.tone}`} role="img" aria-label={dot.label} />;
}

/** The chat tabs (VS Code style): the main chat under the agent's name, which never closes, then the other open chats. ←/→ move between tabs. */
export function ThreadTabs(props: ThreadTabsProps) {
  const strip = useRef<HTMLDivElement>(null);
  const { main, others } = props.tabs;
  const activeId = props.openThreadId ?? main?.id ?? null;
  useEffect(() => {
    strip.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId, others.length]);

  const tab = (thread: Thread | null, isMain: boolean) => {
    const id = thread?.id ?? null;
    const active = id === activeId;
    const title = isMain ? props.agentName : (thread?.title ?? '');
    if (thread !== null && props.renamingId === thread.id) {
      return (
        <div key={thread.id} class="tab active renaming">
          <NameInput initial={thread.title} maxLength={200} label="Chat name" onDone={(name) => { props.onRenamed(thread.id, name); }} />
        </div>
      );
    }
    const status = id === null ? 'idle' : props.statusOf(id);
    const marked = status !== 'idle' || (id !== null && !active && props.unread(id));
    return (
      <div key={id ?? 'main'} class={`tab${active ? ' active' : ''}${isMain ? ' pinned' : ''}${marked ? ' marked' : ''}`}>
        <button
          type="button"
          role="tab"
          class="tab-open"
          aria-selected={active}
          tabIndex={active ? 0 : -1}
          title={isMain && thread !== null ? `${props.agentName} · ${thread.title}` : title}
          onClick={() => { if (id !== null) props.onOpen(id); }}
          onDblClick={() => { if (!isMain && id !== null) props.onRename(id); }}
          onAuxClick={(event) => { if (event.button === 1 && !isMain && id !== null) props.onClose(id); }}
          onContextMenu={(event) => {
            event.preventDefault();
            if (thread !== null) props.onMenu(thread, event.currentTarget, event.button === 2 ? { x: event.clientX, y: event.clientY } : null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'F10' && event.shiftKey && thread !== null) {
              event.preventDefault();
              props.onMenu(thread, event.currentTarget, null);
            }
          }}
        >
          {isMain && <span class="tab-avatar">{props.avatar}</span>}
          <span class="tab-title">{title}</span>
        </button>
        <span class="tab-end">
          {id !== null && <Marker status={status} unread={!active && props.unread(id)} />}
          {!isMain && id !== null && (
            <button type="button" class="tab-close" tabIndex={-1} aria-label={`Close ${title}`} title="Close" onClick={() => { props.onClose(id); }}>
              <Icon name="close" size={14} />
            </button>
          )}
        </span>
      </div>
    );
  };

  return (
    <div
      ref={strip}
      class="tabs"
      role="tablist"
      aria-label="Chats"
      onKeyDown={(event) => {
        const ids = [main?.id, ...others.map(({ id }) => id)].filter((id) => id !== undefined);
        const index = ids.indexOf(activeId ?? '');
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        const next = ids[index + step];
        if (step === 0 || next === undefined) return;
        event.preventDefault();
        props.onOpen(next);
        requestAnimationFrame(() => strip.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
      }}
    >
      {tab(main, true)}
      {others.map((thread) => tab(thread, false))}
    </div>
  );
}
