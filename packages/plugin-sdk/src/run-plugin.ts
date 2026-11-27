import { HostMessage, type PluginMessage } from '@morrowbot/contracts';
import type { PluginDefinition } from './plugin.ts';

type Send = (message: PluginMessage, done?: () => void) => void;

/**
 * Serves a plugin over the IPC channel the host opened. Call it once from the
 * plugin's entry file. The process exits when the host shuts it down or goes away.
 */
export function runPlugin(plugin: PluginDefinition): void {
  const send = ipcSender();
  const streams = new Map<number, AbortController>();
  process.on('disconnect', () => process.exit(0));
  process.on('message', (raw: unknown) => {
    const parsed = HostMessage.safeParse(raw);
    if (!parsed.success) {
      console.error(`MorrowBot plugin: ignored a malformed host message: ${parsed.error.message}`);
      return;
    }
    void handle(plugin, parsed.data, send, streams);
  });
}

function ipcSender(): Send {
  const channel = process.send?.bind(process);
  if (channel === undefined) {
    throw new Error('This plugin must be started by the MorrowBot host (no IPC channel found).');
  }
  return (message, done) => {
    channel(message, undefined, undefined, () => done?.());
  };
}

async function handle(
  plugin: PluginDefinition,
  message: HostMessage,
  send: Send,
  streams: Map<number, AbortController>,
): Promise<void> {
  const { id } = message;
  try {
    switch (message.kind) {
      case 'init':
        await plugin.init?.({ config: message.config });
        send({ kind: 'init-result', id, pluginKind: plugin.kind });
        return;
      case 'health':
        send({ kind: 'health-result', id, health: plugin.health ? await plugin.health() : { kind: 'ok' } });
        return;
      case 'shutdown': {
        for (const controller of streams.values()) controller.abort();
        let reply: PluginMessage = { kind: 'shutdown-result', id };
        try {
          await plugin.shutdown?.();
        } catch (error) {
          reply = failure(id, error);
        }
        send(reply, () => process.exit(0));
        return;
      }
      case 'stream':
        await stream(plugin, message, send, streams);
        return;
      case 'cancel':
        streams.get(id)?.abort();
        return;
    }
  } catch (error) {
    send(failure(id, error));
  }
}

function failure(id: number, error: unknown): PluginMessage {
  return { kind: 'error', id, code: 'failed', message: error instanceof Error ? error.message : String(error) };
}

async function stream(
  plugin: PluginDefinition,
  message: Extract<HostMessage, { kind: 'stream' }>,
  send: Send,
  streams: Map<number, AbortController>,
): Promise<void> {
  const { id } = message;
  switch (plugin.kind) {
    case 'tool':
      send({ kind: 'error', id, code: 'unsupported', message: 'Tool plugins do not stream' });
      return;
    case 'provider':
      break;
  }
  const controller = new AbortController();
  let ended = false;
  streams.set(id, controller);
  try {
    const finishReason = await plugin.stream(message.request, {
      emit: (chunk) => {
        if (!ended && !controller.signal.aborted) send({ kind: 'stream-chunk', id, chunk });
      },
      signal: controller.signal,
    });
    send({ kind: 'stream-end', id, finishReason: controller.signal.aborted ? 'cancelled' : finishReason });
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    send({ kind: 'stream-end', id, finishReason: 'cancelled' });
  } finally {
    ended = true;
    streams.delete(id);
  }
}
