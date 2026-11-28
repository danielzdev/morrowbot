import type { AgentService } from './features/agents/index.ts';
import { createCardService, type CardService } from './features/cards/index.ts';
import type { ChatService } from './features/chat/index.ts';
import type { PluginHost } from './features/plugins/index.ts';
import type { Storage } from './features/storage/index.ts';

/**
 * Cards in chats: staged and published by the chat, offering plugins from the plugin host (all but the built-in
 * providers, which live in Settings › Providers) and the allowlisted settings.
 */
export function cardService(storage: Storage, chat: ChatService, plugins: PluginHost, agents: AgentService): CardService {
  return createCardService({
    store: storage.cards,
    chat: { stageCard: (grant, body) => chat.stageCard(grant, body), publishCard: (card) => { chat.publishCard(card); } },
    plugins: {
      list: () => plugins.list().filter(({ source, manifest }) => !(source === 'built-in' && manifest.kind === 'provider')),
      enabled: async (pluginId) => (await storage.plugins.read(pluginId))?.enabled ?? true,
      setEnabled: (pluginId, enabled) => plugins.setEnabled(pluginId, enabled),
    },
    settings: {
      agent: (id) => agents.get(id),
      globalEmojiReplies: () => storage.chatSettings.get().emojiReplies,
      setAgentEmojiReplies: (agentId, value) => agents.update(agentId, { emojiReplies: value }).kind === 'updated',
    },
  });
}
