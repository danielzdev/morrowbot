import { bindTools, type Binding } from './bindings.ts';
import { McpFailure } from './channel.ts';
import type { AgentConnectorCall, AgentConnectorTool, StoredConnector } from './ports.ts';
import type { ConnectorRuntime } from './runtime.ts';

/** What every check reads besides the saved record: safe mode, member sharing and the live sessions. */
export interface AccessContext {
  readonly safeMode: boolean;
  /** Whether a scoped member may chat with this agent: its turns then get no connectors, since a turn does not say who started it. */
  readonly sharedWithMembers: (agentId: string) => boolean;
  readonly runtime: ConnectorRuntime;
}

type Gate = { readonly kind: 'usable'; readonly bindings: readonly Binding[] } | { readonly kind: 'refused'; readonly reason: string };

/**
 * Whether `agentId` may use this connector right now, checked fresh from the saved record and the live
 * session: safe mode, on/off, the scope record (and any pending scope review), Connect, and a ready session.
 */
export function gate(connector: StoredConnector, agentId: string, context: AccessContext): Gate {
  const { label, scope } = connector;
  if (context.safeMode) return { kind: 'refused', reason: 'Ori Kami is in safe mode, so connectors are off.' };
  if (context.sharedWithMembers(agentId)) return { kind: 'refused', reason: 'Connectors are not given to agents shared with other people.' };
  if (!connector.enabled) return { kind: 'refused', reason: `${label} is turned off.` };
  if (scope.mode === 'selected' && !scope.agentIds.includes(agentId)) return { kind: 'refused', reason: `${label} isn't available to this agent.` };
  if (scope.scopeReviewRequired) return { kind: 'refused', reason: `${label} is paused until its scope is reviewed in Extensions.` };
  if (!connector.connected) return { kind: 'refused', reason: `${label} is disconnected.` };
  const state = context.runtime.state(connector.id);
  if (state.kind !== 'ready') return { kind: 'refused', reason: `${label} isn't connected right now.` };
  return { kind: 'usable', bindings: bindTools(connector, state.tools) };
}

/** The connector tools `agentId` gets in a turn: only instances whose scope and status allow it now. */
export function agentTools(connectors: readonly StoredConnector[], agentId: string, context: AccessContext): AgentConnectorTool[] {
  return connectors.flatMap((connector) => {
    const access = gate(connector, agentId, context);
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
  context: AccessContext,
): Promise<AgentConnectorCall> {
  const connector = connectors.find(({ labelKey }) => boundName.startsWith(`${labelKey}__`));
  if (connector === undefined) return { kind: 'refused', reason: `Unknown tool: ${boundName}` };
  const access = gate(connector, agentId, context);
  if (access.kind === 'refused') return access;
  const binding = access.bindings.find((each) => each.boundName === boundName);
  if (binding === undefined) return { kind: 'refused', reason: `Unknown tool: ${boundName}` };
  try {
    const result = await context.runtime.call(connector.id, binding.toolName, args, signal);
    return { kind: 'result', ...result };
  } catch (error) {
    const reason = error instanceof McpFailure ? error.message : 'The tool call failed';
    return { kind: 'refused', reason: `${connector.label}: ${reason}` };
  }
}
