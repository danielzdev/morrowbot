import type { Agent, ProviderBinding, ProviderInfo } from '@morrowbot/contracts';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { MorrowbotBridge } from '../bridge.ts';
import { AgentSettings, Avatar, ChatTabs, createAgentsModel, NewAgent, Sidebar, type AgentsModel, type Page, type ProviderOption } from '../features/agents/index.ts';
import { AccessNotes, AccessPicker, bindTo, ModelPicker, type BoundProvider } from '../features/binding/index.ts';
import { ChatView, Composer, createChatHub, type ChatHub } from '../features/chat/index.ts';
import { createPluginsModel, PluginsPage, summarize, type PluginCard, type PluginsModel } from '../features/plugins/index.ts';
import { createApi } from '../shared/api.ts';
import { useStore } from '../shared/use-store.ts';

interface Models {
  readonly agents: AgentsModel;
  readonly plugins: PluginsModel;
  readonly chats: ChatHub;
}

function cardOf(plugins: PluginsModel, pluginId: string): PluginCard | undefined {
  const cards = plugins.cards.get();
  return cards.kind === 'loaded' ? cards.value.find(({ entry }) => entry.manifest.id === pluginId) : undefined;
}

function infoOf(card: PluginCard | undefined): ProviderInfo | undefined {
  return card?.info?.kind === 'loaded' ? card.info.value : undefined;
}

function createModels(bridge: MorrowbotBridge): Models {
  const api = createApi(bridge);
  const agents = createAgentsModel({
    api,
    bridge,
    onThreadsDeleted: (threadIds) => {
      for (const threadId of threadIds) chats.forget(threadId);
    },
  });
  const plugins = createPluginsModel({
    api,
    bridge,
    onReleased: () => {
      chats.reloadAll();
    },
  });
  const chats = createChatHub({
    api,
    bridge,
    onGroupsChanged: () => void plugins.load(),
    onFinished: (threadId, message) => {
      const state = agents.state.get();
      const agentId = Object.entries(state.threads).find(([, threads]) => threads.kind === 'loaded' && threads.value.some(({ id }) => id === threadId))?.[0];
      const troubled = message.outcome.kind === 'failed' || message.outcome.kind === 'interrupted';
      if (troubled) void plugins.load();
      if (agentId === undefined) return;
      const view = chats.session(threadId).screen.get().view;
      const first = view.kind === 'loaded' ? view.value.messages.find(({ kind }) => kind === 'user')?.text ?? null : null;
      void agents.touchThread(agentId, threadId, first);
      const agent = state.agents.kind === 'loaded' ? state.agents.value.find(({ id }) => id === agentId) : undefined;
      if (!troubled && agent?.provider.kind === 'bound' && infoOf(cardOf(plugins, agent.provider.pluginId))?.kind !== 'ready') {
        void plugins.refreshInfo(agent.provider.pluginId);
      }
    },
  });
  return { agents, plugins, chats };
}

function ProviderChip(props: { readonly card: PluginCard | undefined; readonly onPlugins: () => void }) {
  if (props.card === undefined) return <span class="chip warning">Provider not installed</span>;
  const summary = summarize(props.card.entry, props.card.info);
  if (summary.state === 'ready' && summary.tone === 'ok') return null;
  return (
    <button class={`chip ${summary.tone}`} onClick={props.onPlugins} title={summary.detail ?? ''}>
      {props.card.entry.manifest.name}: {summary.title}
    </button>
  );
}

function ChatPane(props: { readonly models: Models; readonly agent: Agent; readonly onPage: (page: Page) => void }) {
  const { models, agent } = props;
  const state = useStore(models.agents.state);
  const cards = useStore(models.plugins.cards);
  const threadId = state.openThread[agent.id];
  const binding = agent.provider.kind === 'bound' ? agent.provider : null;
  const card = binding === null || cards.kind !== 'loaded' ? undefined : cards.value.find(({ entry }) => entry.manifest.id === binding.pluginId);
  const info = infoOf(card);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const [bindingProblem, setBindingProblem] = useState<string | null>(null);
  const rebind = (next: BoundProvider): void => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setBindingProblem(null);
    void models.agents.updateAgent(agent.id, { provider: next }).then((result) => {
      inFlight.current = false;
      setSaving(false);
      if (result.kind === 'refused') setBindingProblem(`The change was not saved: ${result.message}`);
    });
  };
  const session = threadId === undefined ? undefined : models.chats.session(threadId);
  return (
    <div class="main">
      <header class="main-header">
        <Avatar agent={agent} />
        <div class="title">
          <strong>{agent.name}</strong>
          {agent.description !== '' && <span class="muted">{agent.description}</span>}
        </div>
        <button class="ghost" onClick={() => { props.onPage({ kind: 'agent-settings' }); }}>
          Settings
        </button>
      </header>
      <ChatTabs model={models.agents} agentId={agent.id} />
      {session === undefined ? (
        <div class="chat empty">
          <p>No chats yet.</p>
          <button class="primary" onClick={() => void models.agents.newThread(agent.id)}>
            New chat
          </button>
        </div>
      ) : (
        <>
          <ChatView key={session.threadId} session={session} locked={saving} />
          <Composer
            key={`composer-${session.threadId}`}
            session={session}
            disabledReason={binding === null ? "Choose a provider in this agent's settings." : saving ? 'Saving the new settings…' : null}
            toolbar={
              binding === null ? (
                <button class="chip warning" onClick={() => { props.onPage({ kind: 'agent-settings' }); }}>
                  No provider
                </button>
              ) : (
                <>
                  <ModelPicker info={info} binding={binding} disabled={saving} onChange={(selection) => { rebind({ ...binding, selection }); }} />
                  <AccessPicker info={info} binding={binding} disabled={saving} onChange={(access, vendorSettings) => { rebind({ ...binding, access, vendorSettings }); }} />
                  <ProviderChip card={card} onPlugins={() => { props.onPage({ kind: 'plugins' }); }} />
                </>
              )
            }
          />
          {bindingProblem !== null && <div class="access-notes note error">{bindingProblem}</div>}
          {binding !== null && <AccessNotes info={info} binding={binding} />}
        </>
      )}
    </div>
  );
}

export function App({ bridge }: { readonly bridge: MorrowbotBridge }) {
  const models = useMemo(() => createModels(bridge), [bridge]);
  const [page, setPage] = useState<Page>({ kind: 'chat' });
  const state = useStore(models.agents.state);
  const cards = useStore(models.plugins.cards);
  useEffect(() => {
    void models.agents.load();
    void models.plugins.load();
    return () => {
      models.chats.close();
      models.plugins.close();
      models.agents.close();
    };
  }, [models]);

  const providers: readonly ProviderOption[] =
    cards.kind === 'loaded'
      ? cards.value.filter(({ entry }) => entry.manifest.kind === 'provider').map(({ entry }) => ({ id: entry.manifest.id, name: entry.manifest.name }))
      : [];
  const bindingFor = (pluginId: string): ProviderBinding => bindTo(pluginId, infoOf(cardOf(models.plugins, pluginId)));
  const agent = state.agents.kind === 'loaded' ? state.agents.value.find(({ id }) => id === state.selectedAgentId) : undefined;

  const content = (() => {
    switch (page.kind) {
      case 'plugins':
        return <PluginsPage model={models.plugins} bridge={bridge} />;
      case 'new-agent':
        return (
          <NewAgent
            model={models.agents}
            bridge={bridge}
            providers={providers}
            bindingFor={bindingFor}
            onCreated={() => {
              setPage({ kind: 'chat' });
            }}
          />
        );
      case 'agent-settings':
        return agent === undefined ? null : (
          <AgentSettings key={agent.id} model={models.agents} agent={agent} providers={providers} bindingFor={bindingFor} onDeleted={() => { setPage({ kind: 'chat' }); }} />
        );
      case 'chat':
        if (agent !== undefined) return <ChatPane key={agent.id} models={models} agent={agent} onPage={setPage} />;
        return (
          <div class="chat empty">
            <p>{state.agents.kind === 'loading' ? 'Loading…' : 'Create an agent to start chatting.'}</p>
            {state.agents.kind === 'loaded' && (
              <button class="primary" onClick={() => { setPage({ kind: 'new-agent' }); }}>
                New agent
              </button>
            )}
          </div>
        );
    }
  })();

  return (
    <div class="app">
      <Sidebar model={models.agents} page={page} onPage={setPage} />
      <div class="content">
        {state.problem !== null && (
          <div class="banner error">
            <div class="banner-row">
              <span>{state.problem}</span>
              <button class="ghost" onClick={() => {
                  models.agents.dismissProblem();
                }}>
                Dismiss
              </button>
            </div>
          </div>
        )}
        {content}
      </div>
    </div>
  );
}
