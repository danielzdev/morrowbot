import type { PluginRuntime } from '@morrowbot/plugin-sdk';
import { actionTools } from './action-tools.ts';
import { createHelper, type Helper } from './helper.ts';
import { observeTools } from './observe-tools.ts';
import { Snapshots } from './snapshots.ts';
import type { ComputerUseTool, ToolOutput } from './tool.ts';

export type { ComputerUseTool, ToolContext, ToolOutput } from './tool.ts';

/** Every tool the Computer Use plugin offers an agent, sharing one set of snapshots. */
export function computerUseTools(helper: Helper): readonly ComputerUseTool[] {
  const snapshots = new Snapshots();
  return [...observeTools(helper, snapshots), ...actionTools(helper, snapshots)];
}

/** The tools on this runtime: the native helper on macOS, `unsupported` everywhere else. */
export function toolsFor(runtime: PluginRuntime, dataDir: string): readonly ComputerUseTool[] {
  return computerUseTools(createHelper(runtime, dataDir));
}

/** Calls a tool by name; for the host's tool route and for tests. */
export async function callTool(tools: readonly ComputerUseTool[], name: string, input: unknown, signal: AbortSignal): Promise<ToolOutput> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) return { kind: 'invalid_input', text: `No tool named ${name}.` };
  return tool.call(input, { signal });
}
