import type { ToolContentBlock } from '@morrowbot/contracts';
import type { PluginToolCallOutcome, PluginToolsPort } from './ports.ts';
import { content, refused, type McpContentBlock, type Tool, type ToolResult } from './tool.ts';

/** Canonical namespace prefix for a plugin's tools, e.g. `computer-use` -> `computer_use_`. */
export function pluginToolPrefix(pluginId: string): string {
  return `${pluginId.replaceAll('-', '_')}_`;
}

/**
 * Builds the full tool list visible to `agentId`: built-in Ori Bot tools first, followed by tools
 * from allowed running tool plugins. Each plugin tool is namespaced under its plugin id prefix unless
 * it already starts with it, and any tool whose exposed name collides with a built-in tool or an
 * earlier plugin's tool is skipped rather than allowed to shadow it.
 */
export function resolveTools(
  builtins: readonly Tool[],
  pluginTools: PluginToolsPort | undefined,
  agentId: string,
  warn: (message: string) => void,
): readonly Tool[] {
  if (pluginTools === undefined) return builtins;
  const claimed = new Set(builtins.map((item) => item.name));
  const resolved: Tool[] = [...builtins];
  const sources = [...pluginTools.list()].sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  for (const source of sources) {
    if (pluginTools.isAllowedForAgent !== undefined && !pluginTools.isAllowedForAgent(agentId, source.pluginId)) continue;
    const prefix = pluginToolPrefix(source.pluginId);
    for (const def of source.tools) {
      const exposedName = def.name.startsWith(prefix) ? def.name : `${prefix}${def.name}`;
      if (claimed.has(exposedName)) {
        warn(`skipped tool "${def.name}" from plugin "${source.pluginId}": name "${exposedName}" is already claimed`);
        continue;
      }
      claimed.add(exposedName);
      resolved.push({
        name: exposedName,
        description: def.description,
        inputSchema: stripSchemaKey(def.inputSchema),
        call: async (grant, args, signal) =>
          toToolResult(
            exposedName,
            await pluginTools.call({
              pluginId: source.pluginId,
              turnId: grant.turnId,
              name: def.name,
              input: args ?? {},
              signal,
            }),
          ),
      });
    }
  }
  return resolved;
}

function stripSchemaKey(schema: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$schema'));
}

function toToolResult(exposedName: string, outcome: PluginToolCallOutcome): ToolResult {
  switch (outcome.kind) {
    case 'result':
      return fromPluginResult(outcome.result);
    case 'unavailable':
      return refused(outcome.reason);
    case 'cancelled':
      return refused(`Tool "${exposedName}" was cancelled.`);
    case 'timeout':
      return refused(`Tool "${exposedName}" timed out.`);
    case 'failed':
      return refused(outcome.message);
  }
}

function fromPluginResult(result: Extract<PluginToolCallOutcome, { kind: 'result' }>['result']): ToolResult {
  switch (result.kind) {
    case 'ok':
      return content(result.content.map(toMcpBlock));
    case 'error':
      return refused(result.message);
  }
}

function toMcpBlock(block: ToolContentBlock): McpContentBlock {
  switch (block.kind) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'image':
      return { type: 'image', data: block.data, mimeType: block.mimeType };
  }
}
