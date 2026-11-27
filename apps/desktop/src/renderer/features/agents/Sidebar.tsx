import type { Agent } from '@morrowbot/contracts';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { PLATFORM, shortcutLabel } from '../../shared/keys.ts';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { Icon } from '../../shared/ui/Icon.tsx';
import { Menu, type MenuItem } from '../../shared/ui/Menu.tsx';
import { useStore } from '../../shared/use-store.ts';
import type { AgentsModel, AgentsState } from './agents-model.ts';
import { AgentRow } from './AgentRow.tsx';
import { GROUP_LABEL, groupAgents, type AgentEntry, type AgentFacts } from './sidebar-groups.ts';
import { SidebarBottom, SidebarTop } from './SidebarChrome.tsx';
import { itemsOf } from './sidebar-window.ts';
import { useAgentList } from './use-agent-list.ts';

/** What the app knows about an agent beyond its chats list: provider readiness and its open chats' activity. */
export type LiveFacts = Pick<AgentFacts, 'providerReady' | 'approvalChats' | 'failed' | 'working'>;

export type SidebarMode = 'docked' | 'rail' | 'overlay';

export interface SidebarProps {
  readonly model: AgentsModel;
  readonly mode: SidebarMode;
  readonly facts: (agent: Agent) => LiveFacts;
  readonly avatar: (agent: Agent, size: number) => ComponentChildren;
  /** Opens the agent, at `threadId` when given (e.g. the chat waiting for approval). */
  readonly onOpenAgent: (agentId: string, threadId: string | null) => void;
  readonly onNewChat: (agentId: string) => void;
  readonly onAgentSettings: (agentId: string) => void;
  readonly onNewAgent: () => void;
  readonly onSettings: () => void;
  readonly onPlugins: () => void;
  readonly onToggle: () => void;
  readonly plugins: { readonly tone: 'warn' | 'danger'; readonly label: string } | null;
  /** Bumped by ⇧⌘F: shows the filter and focuses it. */
  readonly filterRequest: number;
}

const FILTER_FROM = 6;

function approvalChatsOf(entries: readonly AgentEntry[], agentId: string): readonly string[] {
  const status = entries.find(({ agent }) => agent.id === agentId)?.status;
  return status?.kind === 'needs-approval' ? status.threadIds : [];
}

const lastActiveOf = (state: AgentsState, agentId: string): string | null => {
  const threads = state.threads[agentId];
  return threads?.kind === 'loaded' ? (threads.value[0]?.updatedAt ?? null) : null;
};

/** The agents list (spec §3.1): Needs you / Working / Agents, a filter, and the bottom utility bar. */
export function Sidebar(props: SidebarProps) {
  const state = useStore(props.model.state);
  const rail = props.mode === 'rail';
  const [filter, setFilter] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Agent | null>(null);
  const [chooser, setChooser] = useState<{ readonly agentId: string; readonly anchor: HTMLElement } | null>(null);
  const [now, setNow] = useState(Date.now);
  const filterInput = useRef<HTMLInputElement>(null);
  const agents = state.agents.kind === 'loaded' ? state.agents.value : [];
  const unreadAgents = new Set(Object.values(state.unread));
  const showFilter = !rail && (agents.length >= FILTER_FROM || filterOpen);

  const groups = groupAgents(
    agents.map((agent) => ({ agent, ...props.facts(agent), unread: unreadAgents.has(agent.id), lastActive: lastActiveOf(state, agent.id) })),
    showFilter ? filter : '',
  );
  const items = itemsOf(groups, rail);
  const view = useAgentList(items, state.selectedAgentId);
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
    if (props.filterRequest === 0) return;
    setFilterOpen(true);
    requestAnimationFrame(() => filterInput.current?.focus());
  }, [props.filterRequest]);

  const menuFor = (agent: Agent): readonly MenuItem[] => [
    { kind: 'action', id: 'settings', label: 'Agent settings', icon: 'settings', onSelect: () => { props.onAgentSettings(agent.id); } },
    { kind: 'action', id: 'rename', label: 'Rename', icon: 'pencil', onSelect: () => { setRenaming(agent.id); } },
    { kind: 'separator', id: 'sep' },
    { kind: 'action', id: 'delete', label: 'Delete…', icon: 'trash', danger: true, onSelect: () => { setDeleting(agent); } },
  ];
  const titleOf = (agentId: string, threadId: string): string => {
    const threads = state.threads[agentId];
    return (threads?.kind === 'loaded' ? threads.value.find(({ id }) => id === threadId)?.title : undefined) ?? 'Chat';
  };

  return (
    <nav class={`sidebar ${props.mode}`} aria-label="Agents">
      <SidebarTop mode={props.mode} onToggle={props.onToggle} onNewAgent={props.onNewAgent} />
      {showFilter && (
        <div class="sidebar-filter">
          <Icon name="search" />
          <input
            ref={filterInput}
            type="search"
            placeholder="Filter agents…"
            aria-label="Filter agents"
            aria-keyshortcuts={shortcutLabel('filter-agents', PLATFORM)}
            value={filter}
            onInput={(event) => {
              setFilter(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && (filter !== '' || filterOpen)) {
                event.stopPropagation();
                setFilter('');
                setFilterOpen(false);
              }
              if (event.key === 'ArrowDown' && entries.length > 0) {
                event.preventDefault();
                view.moveTo(0);
              }
            }}
          />
        </div>
      )}
      <div ref={view.list} class="agent-list" onKeyDown={view.onKeyDown} onFocusIn={view.onFocusIn} onFocusOut={view.onFocusOut} onScroll={view.onScroll}>
        {state.agents.kind === 'loading' && <div class="sidebar-note">Loading…</div>}
        {state.agents.kind === 'failed' && <div class="sidebar-note danger">{state.agents.message}</div>}
        {state.agents.kind === 'loaded' && agents.length === 0 && !rail && <div class="sidebar-note">No agents yet.</div>}
        {state.agents.kind === 'loaded' && agents.length > 0 && entries.length === 0 && <div class="sidebar-note">No agents match.</div>}
        <div style={{ height: `${String(shown.before)}px` }} />
        {items.slice(shown.start, shown.end).map((item) =>
          item.kind === 'header' ? (
            <div key={item.key} class="kicker group-label" role="presentation">
              {GROUP_LABEL[item.group]}
            </div>
          ) : (
            <AgentRow
              key={item.key}
              entry={item.entry}
              avatar={props.avatar(item.entry.agent, 24)}
              selected={item.entry.agent.id === state.selectedAgentId}
              tabbable={item.entry.agent.id === view.tabStop}
              rail={rail}
              renaming={renaming === item.entry.agent.id}
              now={now}
              onFocus={() => {
                view.setFocusId(item.entry.agent.id);
              }}
              onOpen={(row) => {
                const { agent, status } = item.entry;
                if (status.kind === 'needs-approval' && status.threadIds.length > 1) setChooser({ agentId: agent.id, anchor: row });
                else props.onOpenAgent(agent.id, status.kind === 'needs-approval' ? (status.threadIds[0] ?? null) : null);
              }}
              onNewChat={() => {
                props.onNewChat(item.entry.agent.id);
              }}
              menu={() => menuFor(item.entry.agent)}
              onRenamed={(name) => {
                setRenaming(null);
                if (name !== null) void props.model.updateAgent(item.entry.agent.id, { name });
              }}
            />
          ),
        )}
        <div style={{ height: `${String(shown.after)}px` }} />
      </div>
      <SidebarBottom rail={rail} plugins={props.plugins} onSettings={props.onSettings} onPlugins={props.onPlugins} />
      {chooser !== null && (
        <Menu
          anchor={{ current: chooser.anchor }}
          label="Choose an approval"
          side="right"
          align="start"
          onClose={() => {
            setChooser(null);
          }}
          items={approvalChatsOf(entries, chooser.agentId).map((threadId) => ({ kind: 'action', id: threadId, label: titleOf(chooser.agentId, threadId), icon: 'chat', onSelect: () => { props.onOpenAgent(chooser.agentId, threadId); } }))}
        />
      )}
      {deleting !== null && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          body={<p>Its chats are deleted. The workspace folder stays on disk.</p>}
          confirmLabel="Delete agent"
          tone="danger"
          typeToConfirm={deleting.name}
          onCancel={() => {
            setDeleting(null);
          }}
          onConfirm={() => {
            const id = deleting.id;
            setDeleting(null);
            void props.model.deleteAgent(id);
          }}
        />
      )}
    </nav>
  );
}
