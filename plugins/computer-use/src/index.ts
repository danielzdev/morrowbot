import { defineToolPlugin, runPlugin, type PluginToolResult, type ToolContentBlock } from '@morrowbot/plugin-sdk';
import { unsupportedReason } from './helper.ts';
import { callTool, toolsFor, type ComputerUseTool, type ToolOutput } from './tools.ts';

const TOOL_PREFIX = 'computer_use_';

function toPluginResult(output: ToolOutput): PluginToolResult {
  switch (output.kind) {
    case 'ok': {
      const content: ToolContentBlock[] = [{ kind: 'text', text: output.text }];
      if (output.image !== null) {
        content.push({ kind: 'image', mimeType: 'image/png', data: output.image.base64 });
      }
      return { kind: 'ok', content };
    }
    case 'unverifiable':
      return { kind: 'ok', content: [{ kind: 'text', text: output.text }] };
    case 'refused':
    case 'permission_denied':
    case 'unsupported':
    case 'invalid_input':
    case 'failed':
      return { kind: 'error', message: output.text };
  }
}

runPlugin((runtime) => {
  let tools: readonly ComputerUseTool[] = [];
  let warmup: AbortController | null = null;
  return defineToolPlugin({
    init: ({ dataDir }) => {
      tools = toolsFor(runtime, dataDir);
      if (runtime.platform === 'darwin') {
        warmup = new AbortController();
        void callTool(tools, 'check_permissions', {}, warmup.signal).catch(() => undefined);
      }
    },
    health: () => (runtime.platform === 'darwin' ? { kind: 'ok' } : { kind: 'degraded', detail: unsupportedReason }),
    listTools: () =>
      tools.map(({ name, description, inputSchema }) => ({
        name: `${TOOL_PREFIX}${name}`,
        description,
        inputSchema: { ...inputSchema },
      })),
    callTool: async ({ name, input, signal }) => {
      const localName = name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : name;
      return toPluginResult(await callTool(tools, localName, input, signal));
    },
    shutdown: () => {
      warmup?.abort();
      warmup = null;
      tools = [];
    },
  });
});
