import type { ChatHost, ChatResult } from '../../lib/chat-host.ts';

/** A host call's result, parsed with the shared contracts. `status` 0: never reached the host. */
export type ExtensionsResult<T> = ChatResult<T>;

/** What the Extensions tab asks of the paired host: plugins plus agents for per-agent toggles. */
export type ExtensionsHost = Pick<
  ChatHost,
  'plugins' | 'setPluginEnabled' | 'onPluginChanged' | 'agents' | 'updateAgent' | 'adoptAgent' | 'onAgentChanged' | 'onAgentDeleted'
>;
