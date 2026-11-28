import { withAgentExtension, type Agent } from '@morrowbot/contracts';

export const CONFLICT_LINE = 'Changed elsewhere.';

export type AgentExtensionOutcome =
  | { readonly kind: 'saved'; readonly agent: Agent }
  | { readonly kind: 'conflict'; readonly current: Agent }
  | { readonly kind: 'refused'; readonly message: string };

/** What plugin views need from the agents model to toggle per-agent tool plugins with revision checks. */
export interface AgentExtensionsPort {
  readonly agents: readonly Agent[];
  /** Agent ids whose per-agent extension save is currently in flight (shared across views). */
  readonly savingAgents: readonly string[];
  readonly setDisabled: (agentId: string, disabledExtensions: readonly string[], revision: number) => Promise<AgentExtensionOutcome>;
  readonly adopt: (agent: Agent) => void;
}

export type ExtensionRowProblem =
  | { readonly kind: 'conflict'; readonly current: Agent }
  | { readonly kind: 'refused'; readonly message: string };

export function isPluginEnabledForAgent(agent: Agent, pluginId: string): boolean {
  return !agent.disabledExtensions.includes(pluginId);
}

export function nextDisabledForAgent(agent: Agent, pluginId: string, enabled: boolean): string[] {
  return withAgentExtension(agent.disabledExtensions, pluginId, enabled);
}

export function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  return Object.fromEntries(Object.entries(record).filter(([each]) => each !== key));
}
