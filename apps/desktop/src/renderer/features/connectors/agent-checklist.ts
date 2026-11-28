import type { Connector, ConnectorScope, ConnectorStatus, SetConnectorScopeRequest } from '@morrowbot/contracts';
import type { ScopeSaved } from './connectors-model.ts';
import { isGiven, requestOf, withAgent, type ScopeChoice } from './scope-choice.ts';

/** One connector's staged change in Agent Settings › Extensions: this agent added or removed. */
export interface Staged {
  readonly given: boolean;
  /** The scope as it was loaded when the change was made; Save writes with its revision. */
  readonly base: ConnectorScope;
  /** Why the last Save left this row unsaved. */
  readonly problem: { readonly kind: 'conflict'; readonly current: ConnectorScope } | { readonly kind: 'refused'; readonly message: string } | null;
}

export type Checklist = Readonly<Record<string, Staged>>;

export interface ChecklistRow {
  readonly connector: Connector;
  readonly checked: boolean;
  readonly allAgents: boolean;
  /** False for a connector that is not working: its row is dimmed and shows what is saved. */
  readonly editable: boolean;
  readonly change: { readonly kind: 'none' } | { readonly kind: 'staged' } | NonNullable<Staged['problem']>;
}

/** The status alone decides whether a connector's membership can be changed here (spec IA §5). */
export function canChange(status: ConnectorStatus): boolean {
  switch (status.kind) {
    case 'connected':
    case 'not_connected':
    case 'reconnect_needed':
      return true;
    case 'off_safe_mode':
    case 'turned_off':
    case 'crashed':
    case 'unsupported':
    case 'not_responding':
    case 'starting':
    case 'scope_needs_review':
      return false;
  }
}

const without = (checklist: Checklist, id: string): Checklist => Object.fromEntries(Object.entries(checklist).filter(([key]) => key !== id));

/** Stages this agent in or out. Going back to what was loaded clears the change; a conflicted row waits for Reload. */
export function stage(checklist: Checklist, connector: Connector, agentId: string, given: boolean): Checklist {
  const staged = checklist[connector.id];
  if (staged?.problem?.kind === 'conflict') return checklist;
  const base = staged?.base ?? connector.scope;
  return given === isGiven(base, agentId) ? without(checklist, connector.id) : { ...checklist, [connector.id]: { given, base, problem: null } };
}

export function checklistRows(connectors: readonly Connector[], checklist: Checklist, agentId: string): readonly ChecklistRow[] {
  return connectors.map((connector): ChecklistRow => {
    const editable = canChange(connector.status);
    const staged = checklist[connector.id];
    const conflicted = staged?.problem?.kind === 'conflict';
    if (staged === undefined || (!editable && !conflicted)) {
      return { connector, editable, checked: isGiven(connector.scope, agentId), allAgents: connector.scope.mode === 'all', change: { kind: 'none' } };
    }
    return { connector, editable, checked: staged.given, allAgents: staged.base.mode === 'all' && staged.given, change: staged.problem ?? { kind: 'staged' } };
  });
}

/** The scope Save writes for one staged row. Leaving an All-agents connector selects every other agent there is now. */
export function writeOf(staged: Staged, agentId: string, everyAgentId: readonly string[]): SetConnectorScopeRequest {
  const from: ScopeChoice = staged.base.mode === 'all' ? { mode: 'selected', agentIds: everyAgentId } : staged.base;
  return { ...requestOf(withAgent(from, agentId, staged.given)), revision: staged.base.revision };
}

/** What Save sends: every changed row it can write. A conflicted row is never sent again. */
export function pendingWrites(rows: readonly ChecklistRow[], checklist: Checklist, agentId: string, everyAgentId: readonly string[]): readonly { readonly id: string; readonly request: SetConnectorScopeRequest }[] {
  return rows.flatMap(({ connector, change }) => {
    const staged = checklist[connector.id];
    return staged === undefined || change.kind === 'none' || change.kind === 'conflict' ? [] : [{ id: connector.id, request: writeOf(staged, agentId, everyAgentId) }];
  });
}

/** After one write: a saved row is clean again; any other keeps its change and says why. */
export function settle(checklist: Checklist, id: string, outcome: ScopeSaved): Checklist {
  const staged = checklist[id];
  if (staged === undefined || outcome.kind === 'saved') return without(checklist, id);
  return { ...checklist, [id]: { ...staged, problem: outcome } };
}

/** Reload row: drops the change, so the row shows the newer scope. */
export const reloadRow = without;

/** The question asked before leaving an All-agents connector (spec IA §5). */
export function switchWarning(label: string, agentName: string, agentCount: number): string {
  const rest = agentCount <= 1 ? 'no agents' : `everyone except ${agentName}`;
  return `Turn off ${label} for ${agentName}? On Save, ${label} switches from All agents to Selected agents: ${rest}.`;
}
