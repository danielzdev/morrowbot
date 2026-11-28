import { ConnectorLabel, connectorLabelKey, MAX_CONNECTOR_LABEL, type Agent, type Connector, type ConnectorScope, type ConnectorSetupView, type ConnectorStatus } from '@morrowbot/contracts';

export const EMPTY_LINE = 'Connect an account so your agents can use it, like your calendar or a to-do app.';
export const NO_ROUTE_LINE = "Ori Kami can't use this connector safely right now.";
export const REVIEW_LINE = 'Access is paused until you save a supported scope.';
export const CONFLICT_LINE = 'Changed elsewhere.';
export const FILTERS_FROM = 8;

/** The one status pill a connector shows (spec IA §3). The host has already picked the first status that applies. */
export interface StatusPill {
  readonly tone: 'ok' | 'muted' | 'warning' | 'error';
  readonly label: string;
  /** The host's own words, redacted where they are shown. */
  readonly detail: string | null;
}

const pill = (tone: StatusPill['tone'], label: string, detail: string | null = null): StatusPill => ({ tone, label, detail });

export function statusPill(status: ConnectorStatus): StatusPill {
  switch (status.kind) {
    case 'off_safe_mode':
      return pill('muted', 'Off in safe mode');
    case 'turned_off':
      return pill('muted', 'Turned off');
    case 'crashed':
      return pill('error', 'Crashed', status.message);
    case 'unsupported':
      return pill('muted', 'Unsupported', status.message);
    case 'not_responding':
      return pill('warning', 'Not responding', status.message);
    case 'starting':
      return pill('muted', 'Starting');
    case 'scope_needs_review':
      return pill('warning', 'Scope needs review');
    case 'reconnect_needed':
      return pill('warning', 'Reconnect needed', status.message);
    case 'not_connected':
      return pill('muted', 'Not connected');
    case 'connected':
      return pill('ok', 'Connected');
  }
}

export function needsAttention(status: ConnectorStatus): boolean {
  switch (status.kind) {
    case 'crashed':
    case 'unsupported':
    case 'not_responding':
    case 'scope_needs_review':
    case 'reconnect_needed':
      return true;
    case 'off_safe_mode':
    case 'turned_off':
    case 'starting':
    case 'not_connected':
    case 'connected':
      return false;
  }
}

export function sourceTag(setup: ConnectorSetupView): 'MCP' | 'via Composio' {
  switch (setup.kind) {
    case 'stdio':
    case 'http':
      return 'MCP';
    case 'composio':
      return 'via Composio';
  }
}

export type ConnectorFilter = 'all' | 'attention' | 'composio' | 'mcp';

function passes(connector: Connector, filter: ConnectorFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'attention':
      return needsAttention(connector.status);
    case 'composio':
      return connector.setup.kind === 'composio';
    case 'mcp':
      return connector.setup.kind !== 'composio';
  }
}

/** The rows the search and the filter chips leave, in the host's order. */
export function matching(connectors: readonly Connector[], query: string, filter: ConnectorFilter = 'all'): readonly Connector[] {
  const wanted = query.trim().toLocaleLowerCase();
  return connectors.filter((connector) => connector.label.toLocaleLowerCase().includes(wanted) && passes(connector, filter));
}

export function scopeChip(scope: Pick<ConnectorScope, 'mode' | 'agentIds'>): string {
  if (scope.mode === 'all') return 'All agents';
  const count = scope.agentIds.length;
  return count === 0 ? 'No agents' : count === 1 ? '1 agent' : `${String(count)} agents`;
}

/** Who a Disconnect or Remove affects (spec IA §4): the agents its saved scope names, or every agent there is now. */
export function usedBy(scope: Pick<ConnectorScope, 'mode' | 'agentIds'>, agents: readonly Pick<Agent, 'id' | 'name'>[]): string {
  const ids = scope.mode === 'all' ? agents.map(({ id }) => id) : scope.agentIds;
  const count = ids.length;
  const names = agents.filter(({ id }) => ids.includes(id)).map(({ name }) => name);
  const [first, second] = names;
  const [subject, verb] =
    first === undefined ? [count === 1 ? '1 agent' : `${String(count)} agents`, count === 1 ? 'uses' : 'use']
    : count === 1 ? [first, 'uses']
    : count === 2 && second !== undefined ? [`${first} and ${second}`, 'use']
    : [`${first}, ${String(count - 1)} other ${count === 2 ? 'agent' : 'agents'}`, count === 2 ? 'uses' : 'use'];
  if (scope.mode === 'all') return count === 0 ? 'All agents get this; there are none yet.' : `All agents use this: ${subject}.`;
  return count === 0 ? 'No agents use this.' : `${subject} ${verb} this.`;
}

/** A first label for another account of a service already added ("Gmail · 2"), or '' for its first. */
export function suggestedLabel(toolkit: string, connectors: readonly Connector[]): string {
  const slug = toolkit.trim();
  const added = connectors.filter(({ setup }) => setup.kind === 'composio' && setup.toolkit === slug).length;
  if (slug === '' || added === 0) return '';
  const words = slug.replaceAll(/[_-]+/g, ' ');
  const name = `${words.charAt(0).toUpperCase()}${words.slice(1)}`.slice(0, MAX_CONNECTOR_LABEL - 6).trim();
  const taken = new Set(connectors.map(({ labelKey }) => labelKey));
  let number = added + 1;
  while (taken.has(connectorLabelKey(`${name} · ${String(number)}`))) number += 1;
  return `${name} · ${String(number)}`;
}

/** Why a typed label can't be used, in the contract's words; null while it is fine or still empty. */
export function labelProblemOf(label: string): string | null {
  if (label.trim() === '') return null;
  const parsed = ConnectorLabel.safeParse(label);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
}

/** What Account offers: after a Disconnect, Reconnect (spec IA §7). */
export function connectionActions(connector: Pick<Connector, 'connected' | 'status'>): { readonly connect: 'Connect' | 'Reconnect' | null; readonly disconnect: boolean } {
  const offer = (): 'Connect' | 'Reconnect' | null => {
    switch (connector.status.kind) {
      case 'off_safe_mode':
        return null;
      case 'reconnect_needed':
      case 'crashed':
      case 'unsupported':
      case 'not_responding':
        return 'Reconnect';
      case 'not_connected':
        return connector.connected ? 'Connect' : 'Reconnect';
      case 'turned_off':
      case 'starting':
      case 'scope_needs_review':
      case 'connected':
        return connector.connected ? null : 'Reconnect';
    }
  };
  return { connect: offer(), disconnect: connector.connected };
}
