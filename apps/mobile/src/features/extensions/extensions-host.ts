import type { ApiError, PluginEntry, PluginList } from '@morrowbot/contracts';

/** A host call's result, parsed with the shared contracts. `status` 0: never reached the host. */
export type ExtensionsResult<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'failed'; readonly status: number; readonly error: ApiError['error'] };

/** What the Extensions tab asks of the paired host. */
export interface ExtensionsHost {
  plugins(): Promise<ExtensionsResult<PluginList>>;
  setPluginEnabled(pluginId: string, enabled: boolean): Promise<ExtensionsResult<PluginEntry>>;
  /** Hears every plugin change the host reports, including this app's own `setPluginEnabled`. Returns the unsubscribe. */
  onPluginChanged(listener: (entry: PluginEntry) => void): () => void;
}
