import type { PluginManifest } from './plugin-manifest.ts';
import type { Message } from './messages.ts';
import type { AgentTools } from './tools.ts';

export interface ProviderRequest {
  readonly model: string;
  /** The agent's `AGENTS.md` contents ('' when the file is missing). */
  readonly instructions: string;
  /** The thread's history, oldest first, ending with the new user message. */
  readonly messages: readonly Message[];
  readonly tools: AgentTools;
  /** Aborted when the user stops the generation. */
  readonly signal: AbortSignal;
}

export type ProviderEvent = { readonly kind: 'text'; readonly text: string };

/** A model provider, normally supplied by a provider plugin. */
export interface ChatProvider {
  generate(request: ProviderRequest): AsyncIterable<ProviderEvent>;
}

/** Looks up the chat provider an agent is bound to. Returns undefined when the plugin is missing or disabled. */
export interface ProviderRegistry {
  provider(pluginId: string): ChatProvider | undefined;
}

/** The plugins the host knows about. */
export interface PluginCatalog {
  list(): readonly PluginManifest[];
}
