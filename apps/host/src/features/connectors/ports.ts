import type { ConnectorScope, ConnectorSetup, ScopeMode } from '@morrowbot/contracts';

/** A connector as the store keeps it. `setup` holds its secrets and never leaves the host. */
export interface StoredConnector {
  readonly id: string;
  readonly label: string;
  readonly labelKey: string;
  readonly setup: ConnectorSetup;
  readonly enabled: boolean;
  readonly connected: boolean;
  readonly scope: ConnectorScope;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ScopeChoice {
  readonly mode: ScopeMode;
  readonly agentIds: readonly string[];
}

/** Where connectors are saved (the storage feature provides it). */
export interface ConnectorStore {
  list(): StoredConnector[];
  get(id: string): StoredConnector | undefined;
  insert(connector: Omit<StoredConnector, 'scope'> & { readonly scope: ScopeChoice }): 'saved' | 'label-taken';
  updateAccount(
    id: string,
    account: { readonly label: string; readonly labelKey: string; readonly setup: ConnectorSetup; readonly scopeReviewRequired: boolean; readonly updatedAt: string },
  ): 'saved' | 'label-taken' | 'not-found';
  setEnabled(id: string, enabled: boolean, updatedAt: string): boolean;
  setConnected(id: string, connected: boolean, updatedAt: string): boolean;
  setScope(
    id: string,
    expectedRevision: number,
    scope: ScopeChoice,
    updatedAt: string,
  ): { readonly kind: 'saved' } | { readonly kind: 'conflict'; readonly current: ConnectorScope } | { readonly kind: 'not-found' };
  delete(id: string): boolean;
}

/** A connector tool as an agent's `tools/list` shows it. */
export interface AgentConnectorTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

/** What one connector tool call gave the agent: the server's result as it is, or why nothing was called. */
export type AgentConnectorCall =
  | {
      readonly kind: 'result';
      readonly content: readonly Readonly<Record<string, unknown>>[];
      readonly structuredContent: Readonly<Record<string, unknown>> | null;
      readonly isError: boolean;
    }
  | { readonly kind: 'refused'; readonly reason: string };
