import { runPlugin } from '@morrowbot/plugin-sdk';
import { unsupportedReason } from './helper.ts';
import { callTool, toolsFor } from './tools.ts';

runPlugin((runtime) => ({
  kind: 'tool',
  init: ({ dataDir }) => {
    const tools = toolsFor(runtime, dataDir);
    if (runtime.platform === 'darwin') {
      void callTool(tools, 'check_permissions', {}, new AbortController().signal).catch(() => undefined);
    }
  },
  health: () => (runtime.platform === 'darwin' ? { kind: 'ok' } : { kind: 'degraded', detail: unsupportedReason }),
}));
