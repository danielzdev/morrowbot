import path from 'node:path';
import type { PluginCatalog, ProviderRegistry } from '@morrowbot/contracts';
import { createAgentService } from './features/agents/index.ts';
import { startApiServer } from './features/api/index.ts';
import { createChatService } from './features/chat/index.ts';
import type { HostConfig } from './features/config/index.ts';
import { healthListener } from './features/health/index.ts';
import { openStorage } from './features/storage/index.ts';
import { createWorkspaceTools } from './features/tools/index.ts';

export interface HostOptions {
  readonly config: HostConfig;
  readonly version: string;
  /** Chat providers and the plugin list, supplied by the plugin host. */
  readonly providers: ProviderRegistry;
  readonly catalog: PluginCatalog;
  readonly newId: () => string;
  readonly now: () => string;
  readonly report: (error: unknown) => void;
}

export interface Host {
  readonly url: string;
  close(): Promise<void>;
}

/** Opens storage and serves the local API. Closing stops active generations and saves their partial replies. */
export async function startHost(options: HostOptions): Promise<Host> {
  const { config, newId, now, report } = options;
  const storage = openStorage(path.join(config.dataDir, 'morrowbot.sqlite'));
  const agents = createAgentService({
    records: storage.agents,
    workspacesDir: path.join(config.dataDir, 'workspaces'),
    newId,
    now,
  });
  const chat = createChatService({
    threads: storage.threads,
    messages: storage.messages,
    agents,
    providers: {
      provider: (pluginId) =>
        storage.plugins.enabledStates().get(pluginId) === false ? undefined : options.providers.provider(pluginId),
    },
    toolsFor: createWorkspaceTools,
    newId,
    now,
    report,
  });
  try {
    const api = await startApiServer({
      address: { hostname: config.hostname, port: config.port },
      services: { agents, chat, plugins: { catalog: options.catalog, settings: storage.plugins }, now },
      fallback: healthListener(options.version),
      report,
    });
    return {
      url: api.url,
      close: async () => {
        try {
          await api.close();
          await chat.close();
        } finally {
          storage.close();
        }
      },
    };
  } catch (error) {
    storage.close();
    throw error;
  }
}
