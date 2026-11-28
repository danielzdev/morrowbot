import type { ConnectorScope, ScopeMode } from '@morrowbot/contracts';

/** A scope being chosen, before it is saved. */
export interface ScopeChoice {
  readonly mode: ScopeMode;
  readonly agentIds: readonly string[];
}

/** At install (spec IA §5): Selected agents, with nobody ticked unless the install started from an agent. */
export const choiceAtInstall = (forAgentId: string | null): ScopeChoice => ({ mode: 'selected', agentIds: forAgentId === null ? [] : [forAgentId] });

/** Switching from All agents to Selected agents starts with every current agent ticked. */
export function withMode(choice: ScopeChoice, mode: ScopeMode, everyAgentId: readonly string[]): ScopeChoice {
  if (mode === choice.mode) return choice;
  return { mode, agentIds: mode === 'all' ? [] : everyAgentId };
}

export function withAgent(choice: ScopeChoice, agentId: string, given: boolean): ScopeChoice {
  const others = choice.agentIds.filter((id) => id !== agentId);
  return { mode: choice.mode, agentIds: given ? [...others, agentId] : others };
}

export const isGiven = (scope: ScopeChoice, agentId: string): boolean => scope.mode === 'all' || scope.agentIds.includes(agentId);

export function sameChoice(a: ScopeChoice, b: ScopeChoice): boolean {
  if (a.mode !== b.mode) return false;
  return a.mode === 'all' || (a.agentIds.length === b.agentIds.length && a.agentIds.every((id) => b.agentIds.includes(id)));
}

/** The choice as the host takes it. */
export const requestOf = (choice: ScopeChoice): { mode: ScopeMode; agentIds: string[] } => ({ mode: choice.mode, agentIds: choice.mode === 'all' ? [] : [...choice.agentIds] });

export const choiceOf = (scope: ConnectorScope): ScopeChoice => ({ mode: scope.mode, agentIds: scope.agentIds });
