import type { ProviderInfo } from '@morrowbot/contracts';
import type { MorrowbotBridge } from '../bridge.ts';
import { createAgentsModel, type AgentsModel } from '../features/agents/index.ts';
import { createChatHub, localDrafts, type ChatHub } from '../features/chat/index.ts';
import { createPluginsModel, type PluginCard, type PluginsModel } from '../features/plugins/index.ts';
import { createApi, type Api } from '../shared/api.ts';
import { createAppearance, type AppearanceModel } from '../shared/appearance.ts';
import { createChatPrefs, type ChatPrefsModel } from '../shared/chat-prefs.ts';

export interface Models {
  readonly api: Api;
  readonly agents: AgentsModel;
  readonly plugins: PluginsModel;
  readonly chats: ChatHub;
  readonly appearance: AppearanceModel;
  readonly chatPrefs: ChatPrefsModel;
}

export function cardOf(plugins: PluginsModel, pluginId: string): PluginCard | undefined {
  const cards = plugins.cards.get();
  return cards.kind === 'loaded' ? cards.value.find(({ entry }) => entry.manifest.id === pluginId) : undefined;
}

export function infoOf(card: PluginCard | undefined): ProviderInfo | undefined {
  return card?.info?.kind === 'loaded' ? card.info.value : undefined;
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
    drafts: localDrafts,
    onGroupsChanged: () => void plugins.load(),
    onFinished: (threadId, message) => {
      const state = agents.state.get();
      const agentId = Object.entries(state.threads).find(([, threads]) => threads.kind === 'loaded' && threads.value.some(({ id }) => id === threadId))?.[0];
      const troubled = message.outcome.kind === 'failed' || message.outcome.kind === 'interrupted';
      if (troubled) void plugins.load();
      if (agentId === undefined) return;
      agents.markFinished(agentId, threadId);
      const view = chats.session(threadId).screen.get().view;
      const first = view.kind === 'loaded' ? (view.value.messages.find(({ kind }) => kind === 'user')?.text ?? null) : null;
      void agents.touchThread(agentId, threadId, first);
      const agent = state.agents.kind === 'loaded' ? state.agents.value.find(({ id }) => id === agentId) : undefined;
      if (!troubled && agent?.provider.kind === 'bound' && infoOf(cardOf(plugins, agent.provider.pluginId))?.kind !== 'ready') {
        void plugins.refreshInfo(agent.provider.pluginId);
      }
    },
  });
  return { api, agents, plugins, chats, appearance: createAppearance(document.documentElement), chatPrefs: createChatPrefs() };
}
