import type { PluginManifest } from '@morrowbot/contracts';

export type { PluginManifest };

export interface Plugin {
  readonly manifest: PluginManifest;
  activate(): void | Promise<void>;
}

/** Declares a plugin. The host validates the manifest when it loads the plugin. */
export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}
