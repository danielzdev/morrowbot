import { OPEN } from './fence.ts';
import type { PluginFactory } from './runtime.ts';
import { servePlugin } from './serve.ts';

/**
 * Serves a plugin over the IPC channel the host opened (wire protocol v1). Call it once from the
 * plugin's entry file. Its programs run open (only the host's built-in providers are fenced). The process exits when the host shuts it down or goes away; its command
 * guards then sweep their groups.
 */
export function runPlugin(factory: PluginFactory): void {
  const channel = process.send?.bind(process);
  if (channel === undefined) {
    throw new Error('This plugin must be started by the Ori Bot host (no IPC channel found).');
  }
  const served = servePlugin(factory, {
    env: process.env,
    platform: process.platform,
    fence: OPEN,
    transport: {
      send: (message, done) => {
        channel(message, undefined, undefined, () => done?.());
      },
      exit: () => process.exit(0),
    },
  });
  process.on('disconnect', () => process.exit(0));
  process.on('message', (raw: unknown) => {
    served.receive(raw);
  });
}
