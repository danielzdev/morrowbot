import { defineToolPlugin, runPlugin, type PluginToolResult } from '@morrowbot/plugin-sdk';
import { startBridge, type Bridge } from './bridge.ts';
import { readSettings } from './settings.ts';
import type { BrowserTool, ToolOutput } from './tool.ts';
import { browserTools, callTool } from './tools.ts';

function toPluginResult(output: ToolOutput): PluginToolResult {
  switch (output.kind) {
    case 'text':
      return { kind: 'ok', content: [{ kind: 'text', text: output.text }] };
    case 'image':
      return { kind: 'ok', content: [{ kind: 'image', mimeType: output.mimeType, data: output.base64 }] };
    case 'error':
      return { kind: 'error', message: output.text };
  }
}

runPlugin((runtime) => {
  let bridge: Bridge | null = null;
  let tools: readonly BrowserTool[] = [];
  return defineToolPlugin({
    init: async ({ config }) => {
      const settings = readSettings(config);
      bridge = await startBridge({ serve: runtime.serveLoopback, port: settings.port, pairingToken: settings.pairingToken });
      tools = browserTools({ bridge, uploads: settings.uploads });
    },
    health: () => {
      const connected = bridge?.browsers() ?? [];
      if (connected.length === 0) {
        return { kind: 'degraded', detail: 'No browser connected. Open the Ori Bot browser extension and check that its pairing token and port match these settings.' };
      }
      return { kind: 'ok' };
    },
    listTools: () => tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema: { ...inputSchema } })),
    callTool: async ({ name, input, signal, resolveSecret }) => toPluginResult(await callTool(tools, name, input, { signal, secrets: resolveSecret })),
    shutdown: async () => {
      tools = [];
      await bridge?.close();
      bridge = null;
    },
  });
});
