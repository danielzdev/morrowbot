import { createHash } from 'node:crypto';
import type { McpTool } from './mcp-session.ts';

/** The longest tool name an agent sees; providers add their own prefix (`mcp__morrowbot__`) in front. */
export const MAX_BOUND_NAME = 64;

/** One connector tool as an agent gets it: named `<labelKey>__<tool>`, and carrying the instance it calls. */
export interface Binding {
  readonly boundName: string;
  readonly connectorId: string;
  readonly toolName: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

const shortHash = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 6);

/**
 * Names a connector's tools under its label key, so two accounts of one service (two connectors, two keys)
 * never give an agent the same tool name. A name too long, or one that clashes once cleaned, ends in a short hash of the original.
 */
export function bindTools(connector: { readonly id: string; readonly label: string; readonly labelKey: string }, tools: readonly McpTool[]): Binding[] {
  const used = new Set<string>();
  return tools.map((tool) => {
    let boundName = `${connector.labelKey}__${tool.name.replace(/[^A-Za-z0-9_-]/g, '_')}`;
    if (boundName.length > MAX_BOUND_NAME || used.has(boundName)) boundName = `${boundName.slice(0, MAX_BOUND_NAME - 7)}_${shortHash(tool.name)}`;
    used.add(boundName);
    const description = tool.description === '' ? `From ${connector.label}.` : `From ${connector.label}: ${tool.description}`;
    return { boundName, connectorId: connector.id, toolName: tool.name, description, inputSchema: tool.inputSchema };
  });
}
