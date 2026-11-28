import type { ProviderInfo } from '@morrowbot/contracts';
import type { MorrowbotBridge } from '../bridge.ts';
import { createAgentNotify, createAgentsModel, type AgentNotifyModel, type AgentsModel } from '../features/agents/index.ts';
import { createChatHub, localDrafts, type ChatHub } from '../features/chat/index.ts';
import { createConnectorsModel, type ConnectorsModel } from '../features/connectors/index.ts';
import { createPluginsModel, type PluginsModel } from '../features/plugins/index.ts';
import { createProvidersModel, type ProviderCard, type ProvidersModel } from '../features/providers/index.ts';
import { createRoutinesModel, type RoutinesModel } from '../features/routines/index.ts';
import { createApi, type Api } from '../shared/api.ts';
import { createAppearance, type AppearanceModel } from '../shared/appearance.ts';
import { createChatPrefs, type ChatPrefsModel } from '../shared/chat-prefs.ts';
import { createChatSettings, type ChatSettingsModel } from '../shared/chat-settings.ts';
import { createUpdates, type UpdatesModel } from '../shared/updates.ts';

export interface Models {
  readonly api: Api;
  readonly agents: AgentsModel;
  readonly agentNotify: AgentNotifyModel;
  readonly providers: ProvidersModel;
  readonly plugins: PluginsModel;
  readonly connectors: ConnectorsModel;
  readonly chats: ChatHub;
  readonly appearance: AppearanceModel;
  readonly chatPrefs: ChatPrefsModel;
  readonly chatSettings: ChatSettingsModel;
  readonly updates: UpdatesModel;
  readonly routines: RoutinesModel;
}

export function cardOf(providers: ProvidersModel, pluginId: string): ProviderCard | undefined {
  const cards = providers.cards.get();
  return cards.kind === 'loaded' ? cards.value.find(({ entry }) => entry.manifest.id === pluginId) : undefined;
}

export function infoOf(card: ProviderCard | undefined): ProviderInfo | undefined {
  return card?.info.kind === 'loaded' ? card.info.value : undefined;
}

/** Every model the window holds, wired to each other only here. */
export function createModels(bridge: MorrowbotBridge): Models {
  const api = createApi(bridge);
  const agents = createAgentsModel({
    api,
    bridge,
    onThreadsDeleted: (threadIds) => {
      for (const threadId of threadIds) chats.forget(threadId);
    },
  });
  const providers = createProvidersModel({
    api,
    bridge,
    onReleased: () => {
      chats.reloadAll();
    },
    onChanged: () => void plugins.load(),
  });
  const plugins = createPluginsModel({ api, bridge, onChanged: () => void providers.load() });
  const chats = createChatHub({
    api,
    bridge,
    drafts: localDrafts,
    onGroupsChanged: () => void providers.load(),
    onFinished: (threadId, message) => {
      const state = agents.state.get();
      const agentId = Object.entries(state.threads).find(([, threads]) => threads.kind === 'loaded' && threads.value.some(({ id }) => id === threadId))?.[0];
      const troubled = message.outcome.kind === 'failed' || message.outcome.kind === 'interrupted';
      if (troubled) void providers.load();
      if (agentId === undefined) return;
      agents.markFinished(agentId, threadId);
      const view = chats.session(threadId).screen.get().view;
      const first = view.kind === 'loaded' ? (view.value.messages.find(({ kind }) => kind === 'user')?.text ?? null) : null;
      void agents.touchThread(agentId, threadId, first);
      const agent = state.agents.kind === 'loaded' ? state.agents.value.find(({ id }) => id === agentId) : undefined;
      if (!troubled && agent?.provider.kind === 'bound' && infoOf(cardOf(providers, agent.provider.pluginId))?.kind !== 'ready') {
        void providers.refreshInfo(agent.provider.pluginId);
      }
    },
  });
  const routines = createRoutinesModel({ api, bridge, onPosted: (agentId) => void agents.reloadThreads(agentId) });
  const connectors = createConnectorsModel({ api, bridge });
  return { api, agents, agentNotify: createAgentNotify(), providers, plugins, connectors, chats, appearance: createAppearance(document.documentElement), chatPrefs: createChatPrefs(), chatSettings: createChatSettings(api), updates: createUpdates(bridge), routines };
}
