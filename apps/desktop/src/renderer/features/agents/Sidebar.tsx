import type { Agent, Thread } from '@morrowbot/contracts';
import { useState } from 'preact/hooks';
import { useStore } from '../../shared/use-store.ts';
import type { AgentsModel } from './agents-model.ts';

export type Page = { readonly kind: 'chat' } | { readonly kind: 'agent-settings' } | { readonly kind: 'new-agent' } | { readonly kind: 'plugins' };

export function Avatar({ agent }: { readonly agent: Agent }) {
  const initials = agent.name
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span class="avatar" style={{ background: agent.avatar.color }} aria-hidden="true">
      {initials}
    </span>
  );
}

export function Sidebar(props: { readonly model: AgentsModel; readonly page: Page; readonly onPage: (page: Page) => void }) {
  const state = useStore(props.model.state);
  return (
    <nav class="sidebar" aria-label="Agents">
      <div class="brand">MorrowBot</div>
      <div class="section-label">Agents</div>
      <div class="agent-list">
        {state.agents.kind === 'loading' && <div class="muted pad">Loading…</div>}
        {state.agents.kind === 'failed' && <div class="note error pad">{state.agents.message}</div>}
        {state.agents.kind === 'loaded' &&
          state.agents.value.map((agent) => (
            <button
              key={agent.id}
              class={`agent-item ${agent.id === state.selectedAgentId && props.page.kind !== 'plugins' && props.page.kind !== 'new-agent' ? 'selected' : ''}`}
              onClick={() => {
                props.model.selectAgent(agent.id);
                props.onPage({ kind: 'chat' });
              }}
            >
              <Avatar agent={agent} />
              <span class="agent-name">{agent.name}</span>
              {agent.provider.kind === 'unbound' && <span class="dot" title="No provider" />}
            </button>
          ))}
      </div>
      <button class={`nav-item ${props.page.kind === 'new-agent' ? 'selected' : ''}`} onClick={() => { props.onPage({ kind: 'new-agent' }); }}>
        + New agent
      </button>
      <div class="spacer" />
      <button class={`nav-item ${props.page.kind === 'plugins' ? 'selected' : ''}`} onClick={() => { props.onPage({ kind: 'plugins' }); }}>
        Plugins
      </button>
    </nav>
  );
}

function Tab(props: { readonly thread: Thread; readonly open: boolean; readonly model: AgentsModel; readonly agentId: string }) {
  const [editing, setEditing] = useState(false);
  const { thread, model, agentId } = props;
  if (editing) {
    return (
      <input
        class="tab editing"
        aria-label="Chat name"
        defaultValue={thread.title}
        ref={(input) => input?.focus()}
        onBlur={() => { setEditing(false); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setEditing(false);
          if (event.key !== 'Enter') return;
          const title = event.currentTarget.value.trim();
          setEditing(false);
          if (title !== '' && title !== thread.title) void model.renameThread(agentId, thread.id, title);
        }}
      />
    );
  }
  return (
    <div class={`tab ${props.open ? 'open' : ''}`} role="tab" aria-selected={props.open}>
      <button class="tab-title" title="Double-click to rename" onClick={() => { model.openThread(agentId, thread.id); }} onDblClick={() => { setEditing(true); }}>
        {thread.title}
      </button>
      <button
        class="tab-close"
        aria-label={`Delete ${thread.title}`}
        title="Delete chat"
        onClick={() => {
          if (window.confirm(`Delete “${thread.title}”? Its messages are removed.`)) void model.deleteThread(agentId, thread.id);
        }}
      >
        ×
      </button>
    </div>
  );
}

/** One tab per chat of the agent, newest first, plus a new-chat button. */
export function ChatTabs(props: { readonly model: AgentsModel; readonly agentId: string }) {
  const state = useStore(props.model.state);
  const threads = state.threads[props.agentId];
  const open = state.openThread[props.agentId];
  return (
    <div class="tabs" role="tablist">
      {threads?.kind === 'loaded' &&
        threads.value.map((thread) => (
          <Tab key={thread.id} thread={thread} open={thread.id === open} model={props.model} agentId={props.agentId} />
        ))}
      {threads?.kind === 'failed' && <span class="note error">{threads.message}</span>}
      <button class="tab-new" aria-label="New chat" title="New chat" onClick={() => void props.model.newThread(props.agentId)}>
        +
      </button>
    </div>
  );
}
