import type { PluginStatus, PluginToolDefinition, PluginToolResult } from '@morrowbot/contracts';
import { PluginCancelledError, PluginGoneError, PluginRequestError, PluginTimeoutError } from './plugin-errors.ts';
import type { Slot } from './slot.ts';

export interface PluginToolEntry {
  readonly pluginId: string;
  readonly tools: readonly PluginToolDefinition[];
}

export type PluginToolCallAnswer =
  | { readonly kind: 'result'; readonly result: PluginToolResult }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'failed'; readonly message: string };

/** What the agent-tools MCP bridge asks of tool plugins. */
export interface ToolRequests {
  /** Running, enabled, unquarantined tool plugins and their declared tools, sorted by pluginId. */
  listPluginTools(): readonly PluginToolEntry[];
  /** Routes one tool call to a running tool plugin, cancelling it if `signal` aborts. */
  callPluginTool(request: {
    readonly pluginId: string;
    readonly turnId: string;
    readonly name: string;
    readonly input: unknown;
    readonly signal: AbortSignal;
  }): Promise<PluginToolCallAnswer>;
}

export interface ToolRequestDeps {
  readonly slots: ReadonlyMap<string, Slot>;
  readonly statusOf: (slot: Slot) => PluginStatus;
  readonly isServing: (slot: Slot) => boolean;
}

export function toolRequests({ slots, statusOf, isServing }: ToolRequestDeps): ToolRequests {
  return {
    listPluginTools: () =>
      [...slots.values()]
        .filter((slot) => slot.plugin.manifest.kind === 'tool' && isServing(slot) && slot.process !== undefined && slot.tools !== undefined)
        .map((slot) => ({ pluginId: slot.plugin.manifest.id, tools: slot.tools ?? [] }))
        .sort((a, b) => a.pluginId.localeCompare(b.pluginId)),
    callPluginTool: async ({ pluginId, turnId, name, input, signal }) => {
      const slot = slots.get(pluginId);
      if (slot === undefined) return { kind: 'unavailable', reason: `Unknown plugin "${pluginId}"` };
      if (slot.plugin.manifest.kind !== 'tool') return { kind: 'unavailable', reason: `Plugin "${pluginId}" is not a tool plugin` };
      const child = slot.process;
      if (child === undefined || !isServing(slot)) {
        return { kind: 'unavailable', reason: `Plugin "${pluginId}" is not running (${statusOf(slot).kind})` };
      }
      if (signal.aborted) return { kind: 'cancelled' };
      try {
        const result = await child.callTool(turnId, name, input, signal);
        return { kind: 'result', result };
      } catch (error) {
        if (error instanceof PluginCancelledError) return { kind: 'cancelled' };
        if (error instanceof PluginTimeoutError) return { kind: 'timeout' };
        if (error instanceof PluginGoneError) return { kind: 'unavailable', reason: `Plugin "${pluginId}" stopped while running "${name}"` };
        if (error instanceof PluginRequestError) return { kind: 'failed', message: error.message };
        return { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
