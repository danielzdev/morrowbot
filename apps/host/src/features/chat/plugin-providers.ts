import type {
  ChatMessage,
  ChatProvider,
  FinishReason,
  Message,
  PluginKind,
  PluginStatus,
  ProviderEvent,
  ProviderRegistry,
  ProviderStreamRequest,
  StreamChunk,
} from '@morrowbot/contracts';

/** The part of the plugin host that runs provider plugins. */
export interface ProviderPlugins {
  list(): readonly { readonly manifest: { readonly id: string; readonly kind: PluginKind }; readonly status: PluginStatus }[];
  stream(
    pluginId: string,
    request: ProviderStreamRequest,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<FinishReason>;
}

/** Serves each running provider plugin as a chat provider. */
export function pluginProviders(plugins: ProviderPlugins): ProviderRegistry {
  return {
    provider: (pluginId) => {
      const plugin = plugins.list().find(({ manifest }) => manifest.id === pluginId);
      if (plugin?.manifest.kind !== 'provider') return undefined;
      switch (plugin.status.kind) {
        case 'running':
        case 'unhealthy':
          return streamingProvider(plugins, pluginId);
        case 'safe-mode':
        case 'disabled':
        case 'invalid-config':
        case 'starting':
        case 'crashed':
        case 'stopped':
          return undefined;
      }
    },
  };
}

function streamingProvider(plugins: ProviderPlugins, pluginId: string): ChatProvider {
  return {
    async *generate({ instructions, messages, signal }) {
      const chunks: string[] = [];
      let settled: { readonly kind: 'done' } | { readonly kind: 'failed'; readonly error: unknown } | undefined;
      let wake: (() => void) | undefined;
      const notify = (): void => {
        wake?.();
      };
      plugins.stream(pluginId, { messages: toChatMessages(instructions, messages) }, (chunk) => {
        chunks.push(chunk.text);
        notify();
      }, signal).then(
        () => {
          settled = { kind: 'done' };
          notify();
        },
        (error: unknown) => {
          settled = { kind: 'failed', error };
          notify();
        },
      );
      for (;;) {
        const text = chunks.shift();
        if (text !== undefined) {
          const event: ProviderEvent = { kind: 'text', text };
          yield event;
        } else if (settled?.kind === 'done') {
          return;
        } else if (settled?.kind === 'failed') {
          throw settled.error;
        } else {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      }
    },
  };
}

function toChatMessages(instructions: string, messages: readonly Message[]): ChatMessage[] {
  const history = messages
    .filter((message) => message.text !== '')
    .map((message): ChatMessage => ({ role: message.kind, content: message.text }));
  return instructions === '' ? history : [{ role: 'system', content: instructions }, ...history];
}
