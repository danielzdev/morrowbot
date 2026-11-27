import type { Agent } from '@morrowbot/contracts';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { MenuItem } from '../../shared/ui/Menu.tsx';
import { useStore } from '../../shared/use-store.ts';
import { AgentRow } from './AgentRow.tsx';
import type { AgentsModel } from './agents-model.ts';
import { NameInput } from '../../shared/ui/NameInput.tsx';
import { SectionHeader } from './SectionHeader.tsx';
import { groupAgents, sectionKey, type AgentEntry, type AgentFacts } from './sidebar-groups.ts';
import { SidebarBottom, SidebarSearch, SidebarTop } from './SidebarChrome.tsx';
import { moveItems, SidebarPopups, type RowPopup } from './SidebarPopups.tsx';
import { itemsOf } from './sidebar-window.ts';
import { useAgentList } from './use-agent-list.ts';
import { useFolderUi } from './use-folder-ui.ts';

/** What the app knows about an agent beyond the host's list: provider readiness and its open chats' activity. */
export type LiveFacts = Pick<AgentFacts, 'providerReady' | 'approvalChats' | 'failed' | 'working'>;

export type SidebarMode = 'docked' | 'rail' | 'overlay';

export interface SidebarProps {
  readonly model: AgentsModel;
  readonly mode: SidebarMode;
  readonly facts: (agent: Agent) => LiveFacts;
  readonly avatar: (agent: Agent, size: number) => ComponentChildren;
  /** Makes message previews safe to show (spec §9.1). */
  readonly redact: (text: string) => string;
  /** Opens the agent, at `threadId` when given (e.g. the chat waiting for approval). */
  readonly onOpenAgent: (agentId: string, threadId: string | null) => void;
  readonly onNewChat: (agentId: string) => void;
  readonly onAgentSettings: (agentId: string) => void;
  readonly onNewAgent: () => void;
  readonly onSettings: () => void;
  readonly onUsage: () => void;
  readonly onExtensions: () => void;
  readonly onToggle: () => void;
  readonly alert: { readonly tone: 'warn' | 'danger'; readonly label: string } | null;
  /** Bumped by ⇧⌘F: focuses the search. */
  readonly filterRequest: number;
}

const AVATAR_PX = 44;
const NONE_FOLDED: ReadonlySet<string> = new Set();
const RAIL_AVATAR_PX = 36;

/** The agents list (spec §3.1, messenger style): search, Needs you / Working, Agents, the person's folders, then Extensions and Settings. */
export function Sidebar(props: SidebarProps) {
  const state = useStore(props.model.state);
  const rail = props.mode === 'rail';
  const folders = useFolderUi(props.model);
  const [filter, setFilter] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Agent | null>(null);
  const [popup, setPopup] = useState<RowPopup | null>(null);
  const [now, setNow] = useState(Date.now);
  const search = useRef<HTMLInputElement>(null);
  const agents = state.agents.kind === 'loaded' ? state.agents.value : [];
  const unreadAgents = new Set(Object.values(state.unread));

  const facts = agents.map((agent): AgentFacts => ({ agent, ...props.facts(agent), unread: unreadAgents.has(agent.id), lastMessage: state.lastMessages[agent.id] ?? null }));
  const groups = groupAgents(facts, state.folders, rail ? '' : filter);
  const items = itemsOf(groups, rail, filter === '' || rail ? folders.folded : NONE_FOLDED);
  const view = useAgentList(items, state.selectedAgentId, rail);
  const { entries, shown } = view;

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (props.filterRequest !== 0) requestAnimationFrame(() => search.current?.focus());
  }, [props.filterRequest]);

  const rowOf = (agentId: string): HTMLElement | null => view.list.current?.querySelector<HTMLElement>(`[data-agent="${agentId}"]`) ?? null;
  const menuFor = (agent: Agent): readonly MenuItem[] => [
    { kind: 'action', id: 'new-chat', label: 'New chat', icon: 'plus', onSelect: () => { props.onNewChat(agent.id); } },
    { kind: 'action', id: 'settings', label: 'Agent settings', icon: 'settings', onSelect: () => { props.onAgentSettings(agent.id); } },
    ...(rail ? [] : [{ kind: 'action', id: 'rename', label: 'Rename', icon: 'pencil', onSelect: () => { setRenaming(agent.id); } } satisfies MenuItem]),
    ...(rail && moveItems(agent, state.folders, () => undefined, null).length === 0
      ? []
      : [
          {
            kind: 'action',
            id: 'move',
            label: 'Move to folder…',
            icon: 'folder',
            onSelect: () => {
              const anchor = rowOf(agent.id);
              if (anchor !== null) setPopup({ kind: 'move', agent, anchor });
            },
          } satisfies MenuItem,
        ]),
    { kind: 'separator', id: 'sep' },
    { kind: 'action', id: 'delete', label: 'Delete…', icon: 'trash', danger: true, onSelect: () => { setDeleting(agent); } },
  ];
  const titleOf = (agentId: string, threadId: string): string => {
    const threads = state.threads[agentId];
    return (threads?.kind === 'loaded' ? threads.value.find(({ id }) => id === threadId)?.title : undefined) ?? 'Chat';
  };
  const open = (entry: AgentEntry, row: HTMLElement): void => {
    const { agent, status } = entry;
    if (status.kind === 'needs-approval' && status.threadIds.length > 1) {
      const items = status.threadIds.map((threadId): MenuItem => ({ kind: 'action', id: threadId, label: titleOf(agent.id, threadId), icon: 'chat', onSelect: () => { props.onOpenAgent(agent.id, threadId); } }));
      setPopup({ kind: 'approval', agentId: agent.id, anchor: row, items });
    } else props.onOpenAgent(agent.id, status.kind === 'needs-approval' ? (status.threadIds[0] ?? null) : null);
  };

  return (
    <nav class={`sidebar ${props.mode}`} aria-label="Agents">
      <SidebarTop mode={props.mode} onToggle={props.onToggle} onNewAgent={props.onNewAgent} />
      {!rail && <SidebarSearch inputRef={search} value={filter} onChange={setFilter} onDown={() => { view.moveTo(0); }} onNewAgent={props.onNewAgent} />}
      {!rail && folders.draft !== null && (
        <div class="folder-draft">
          <NameInput initial="" maxLength={80} label="New folder name" placeholder="Folder name" onDone={(name) => void folders.finishDraft(name)} />
        </div>
      )}
      <div ref={view.list} class="agent-list" onKeyDown={view.onKeyDown} onFocusIn={view.onFocusIn} onFocusOut={view.onFocusOut} onScroll={view.onScroll}>
        {state.agents.kind === 'loading' && <div class="sidebar-note">Loading…</div>}
        {state.agents.kind === 'failed' && <div class="sidebar-note danger">{props.redact(state.agents.message)}</div>}
        {state.agents.kind === 'loaded' && agents.length > 0 && entries.length === 0 && filter !== '' && <div class="sidebar-note">No agents match.</div>}
        <div style={{ height: `${String(shown.before)}px` }} />
        {items.slice(shown.start, shown.end).map((item) => {
          switch (item.kind) {
            case 'header': {
              const { section } = item;
              const folderId = section.kind === 'folder' ? section.folder.id : null;
              return (
                <SectionHeader
                  key={item.key}
                  section={section}
                  count={item.count}
                  collapsed={item.collapsed}
                  renaming={folderId !== null && folders.renaming === folderId}
                  onToggle={() => { if (filter === '') folders.toggle(sectionKey(section)); }}
                  onNewFolder={() => { folders.startDraft(null); }}
                  onRename={() => { folders.startRename(folderId); }}
                  onRenamed={(name) => { if (folderId !== null) folders.finishRename(folderId, name); }}
                  onDelete={() => { if (section.kind === 'folder') folders.askDelete(section.folder); }}
                />
              );
            }
            case 'empty':
              return <div key={item.key} class="sidebar-note folder-empty">Empty. Right-click an agent › Move to folder.</div>;
            case 'agent':
              return (
                <AgentRow
                  key={item.key}
                  entry={item.entry}
                  avatar={props.avatar(item.entry.agent, rail ? RAIL_AVATAR_PX : AVATAR_PX)}
                  selected={item.entry.agent.id === state.selectedAgentId}
                  tabbable={item.entry.agent.id === view.tabStop}
                  rail={rail}
                  renaming={renaming === item.entry.agent.id}
                  now={now}
                  redact={props.redact}
                  onFocus={() => { view.setFocusId(item.entry.agent.id); }}
                  onOpen={(row) => { open(item.entry, row); }}
                  onMenu={(anchor, at) => { setPopup({ kind: 'actions', agent: item.entry.agent, anchor, at, items: menuFor(item.entry.agent) }); }}
                  onRenamed={(name) => {
                    setRenaming(null);
                    if (name !== null) void props.model.updateAgent(item.entry.agent.id, { name });
                  }}
                />
              );
          }
        })}
        <div style={{ height: `${String(shown.after)}px` }} />
      </div>
      <SidebarBottom rail={rail} alert={props.alert} onSettings={props.onSettings} onUsage={props.onUsage} onExtensions={props.onExtensions} />
      <SidebarPopups
        popup={popup}
        folders={state.folders}
        deletingAgent={deleting}
        deletingFolder={folders.deleting}
        onClosePopup={() => { setPopup(null); }}
        onMove={(agentId, folderId) => void props.model.updateAgent(agentId, { folderId })}
        onNewFolderFor={rail ? null : folders.startDraft}
        onCancelDeleteAgent={() => { setDeleting(null); }}
        onDeleteAgent={(id) => {
          setDeleting(null);
          void props.model.deleteAgent(id);
        }}
        onCancelDeleteFolder={() => { folders.askDelete(null); }}
        onDeleteFolder={folders.confirmDelete}
      />
    </nav>
  );
}
