import { runPlugin } from '@morrowbot/plugin-sdk';
import { startBridge, type Bridge } from './bridge.ts';
import { readSettings } from './settings.ts';

runPlugin((runtime) => {
  let bridge: Bridge | null = null;
  return {
    kind: 'tool',
    init: async ({ config }) => {
      const settings = readSettings(config);
      bridge = await startBridge({ serve: runtime.serveLoopback, port: settings.port, pairingToken: settings.pairingToken });
    },
    health: () => {
      const connected = bridge?.browsers() ?? [];
      if (connected.length === 0) {
        return { kind: 'degraded', detail: 'No browser connected. Open the MorrowBot browser extension and check that its pairing token and port match these settings.' };
      }
      return { kind: 'ok' };
    },
    shutdown: async () => {
      await bridge?.close();
    },
  };
});
