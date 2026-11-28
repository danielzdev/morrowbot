import type { ChatHost, ChatResult } from '../../lib/chat-host.ts';

/** A host call's result, parsed with the shared contracts. `status` 0: never reached the host. */
export type ExtensionsResult<T> = ChatResult<T>;

/** What the Extensions tab asks of the paired host: the plugin part of the host's API. */
export type ExtensionsHost = Pick<ChatHost, 'plugins' | 'setPluginEnabled' | 'onPluginChanged'>;
