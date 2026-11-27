import path from 'node:path';
import type { PluginStatusEvent, ProviderRegistry } from '@morrowbot/contracts';
import { createAgentService } from './features/agents/index.ts';
import { startApiServer } from './features/api/index.ts';
import { createChatService } from './features/chat/index.ts';
import type { HostConfig } from './features/config/index.ts';
import { healthListener } from './features/health/index.ts';
import { startPluginHost, type PluginHost } from './features/plugins/index.ts';
import { openStorage } from './features/storage/index.ts';
import { createWorkspaceTools } from './features/tools/index.ts';

export interface HostOptions {
  readonly config: HostConfig;
  readonly version: string;
  /** Chooses the chat providers. The app serves the plugin host's provider plugins (`pluginProviders`). */
  readonly providers: (plugins: PluginHost) => ProviderRegistry;
  readonly onPluginStatus: (event: PluginStatusEvent) => void;
  readonly newId: () => string;
  readonly now: () => string;
  readonly report: (error: unknown) => void;
}

export interface Host {
  readonly url: string;
  readonly plugins: PluginHost;
  close(): Promise<void>;
}

/**
 * Opens storage, starts the plugins, and serves the local API.
 * Closing stops active generations (saving their partial replies), then the plugins, then storage.
 */
export async function startHost(options: HostOptions): Promise<Host> {
  const { config, newId, now, report } = options;
  const storage = openStorage(path.join(config.dataDir, 'morrowbot.sqlite'), now);
  let plugins: PluginHost;
  try {
    plugins = await startPluginHost({
      pluginsDir: config.pluginsDir,
      safeMode: config.safeMode,
      store: storage.plugins,
      onStatus: options.onPluginStatus,
    });
  } catch (error) {
    storage.close();
    throw error;
  }
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
    providers: options.providers(plugins),
    toolsFor: createWorkspaceTools,
    newId,
    now,
    report,
  });
  try {
    const api = await startApiServer({
      address: { hostname: config.hostname, port: config.port },
      services: {
        agents,
        chat,
        plugins: {
          list: () => plugins.list(),
          saved: (pluginId) => storage.plugins.read(pluginId),
          setEnabled: (pluginId, enabled) => plugins.setEnabled(pluginId, enabled),
          setConfig: (pluginId, input) => plugins.setConfig(pluginId, input),
        },
      },
      fallback: healthListener(options.version),
      report,
    });
    return {
      url: api.url,
      plugins,
      close: async () => {
        try {
          await api.close();
          await chat.close();
          await plugins.stop();
        } finally {
          storage.close();
        }
      },
    };
  } catch (error) {
    await plugins.stop();
    storage.close();
    throw error;
  }
}
