import { bindTools, type Binding } from './bindings.ts';
import { McpFailure } from './channel.ts';
import type { AgentConnectorCall, AgentConnectorTool, StoredConnector } from './ports.ts';
import type { ConnectorRuntime } from './runtime.ts';

type Gate = { readonly kind: 'usable'; readonly bindings: readonly Binding[] } | { readonly kind: 'refused'; readonly reason: string };

/**
 * Whether `agentId` may use this connector right now, checked fresh from the saved record and the live
 * session: safe mode, on/off, the scope record (and any pending scope review), Connect, and a ready session.
 */
export function gate(connector: StoredConnector, agentId: string, safeMode: boolean, runtime: ConnectorRuntime): Gate {
  const { label, scope } = connector;
  if (safeMode) return { kind: 'refused', reason: 'MorrowBot is in safe mode, so connectors are off.' };
  if (!connector.enabled) return { kind: 'refused', reason: `${label} is turned off.` };
  if (scope.mode === 'selected' && !scope.agentIds.includes(agentId)) return { kind: 'refused', reason: `${label} isn't available to this agent.` };
  if (scope.scopeReviewRequired) return { kind: 'refused', reason: `${label} is paused until its scope is reviewed in Extensions.` };
  if (!connector.connected) return { kind: 'refused', reason: `${label} is disconnected.` };
  const state = runtime.state(connector.id);
  if (state.kind !== 'ready') return { kind: 'refused', reason: `${label} isn't connected right now.` };
  return { kind: 'usable', bindings: bindTools(connector, state.tools) };
}

/** The connector tools `agentId` gets in a turn: only instances whose scope and status allow it now. */
export function agentTools(connectors: readonly StoredConnector[], agentId: string, safeMode: boolean, runtime: ConnectorRuntime): AgentConnectorTool[] {
  return connectors.flatMap((connector) => {
    const access = gate(connector, agentId, safeMode, runtime);
    return access.kind === 'usable' ? access.bindings.map(({ boundName, description, inputSchema }) => ({ name: boundName, description, inputSchema })) : [];
  });
}

/** Calls a connector tool as `agentId`, after checking that instance's scope and status again. */
export async function callAgentTool(
  connectors: readonly StoredConnector[],
  agentId: string,
  boundName: string,
  args: unknown,
  signal: AbortSignal,
  safeMode: boolean,
  runtime: ConnectorRuntime,
): Promise<AgentConnectorCall> {
  const connector = connectors.find(({ labelKey }) => boundName.startsWith(`${labelKey}__`));
  if (connector === undefined) return { kind: 'refused', reason: `Unknown tool: ${boundName}` };
  const access = gate(connector, agentId, safeMode, runtime);
  if (access.kind === 'refused') return access;
  const binding = access.bindings.find((each) => each.boundName === boundName);
  if (binding === undefined) return { kind: 'refused', reason: `Unknown tool: ${boundName}` };
  try {
    const result = await runtime.call(connector.id, binding.toolName, args, signal);
    return { kind: 'result', ...result };
  } catch (error) {
    const reason = error instanceof McpFailure ? error.message : 'The tool call failed';
    return { kind: 'refused', reason: `${connector.label}: ${reason}` };
  }
}
