import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { ConnectorScope, ConnectorSetup, ScopeMode } from '@morrowbot/contracts';
import { z } from 'zod';
import { jsonColumn } from './columns.ts';

/** A stored connector instance. `setup` holds its secrets: it never leaves the host. */
export interface ConnectorRecord {
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

export type NewConnector = Omit<ConnectorRecord, 'scope'> & { readonly scope: { readonly mode: ScopeMode; readonly agentIds: readonly string[] } };

export type LabelWrite = 'saved' | 'label-taken' | 'not-found';
export type ScopeWrite = { readonly kind: 'saved' } | { readonly kind: 'conflict'; readonly current: ConnectorScope } | { readonly kind: 'not-found' };

export interface ConnectorRepository {
  list(): ConnectorRecord[];
  get(id: string): ConnectorRecord | undefined;
  /** Saves the connector and its scope together. */
  insert(connector: NewConnector): 'saved' | 'label-taken';
  /** Saves a new label and setup; `scopeReviewRequired: true` also pauses its scope (a new revision) until a scope is saved. */
  updateAccount(id: string, account: { readonly label: string; readonly labelKey: string; readonly setup: ConnectorSetup; readonly scopeReviewRequired: boolean; readonly updatedAt: string }): LabelWrite;
  setEnabled(id: string, enabled: boolean, updatedAt: string): boolean;
  setConnected(id: string, connected: boolean, updatedAt: string): boolean;
  /** Writes the scope only while it is still at `expectedRevision`, clearing any pending scope review. */
  setScope(id: string, expectedRevision: number, scope: { readonly mode: ScopeMode; readonly agentIds: readonly string[] }, updatedAt: string): ScopeWrite;
  delete(id: string): boolean;
}

const Flag = z.union([z.literal(0), z.literal(1)]).transform((value) => value === 1);

const ConnectorRow = z.object({
  id: z.string(),
  label: z.string(),
  label_key: z.string(),
  setup: jsonColumn(ConnectorSetup),
  enabled: Flag,
  connected: Flag,
  scope_mode: ScopeMode,
  scope_revision: z.int(),
  scope_review_required: Flag,
  created_at: z.string(),
  updated_at: z.string(),
});
const AgentRow = z.object({ agent_id: z.string() });

const isUniqueViolation = (error: unknown): boolean => error instanceof Error && /UNIQUE constraint failed: connectors\.label_key/.test(error.message);

export function connectorRepository(db: DatabaseSync): ConnectorRepository {
  const list = db.prepare('SELECT * FROM connectors ORDER BY created_at, id');
  const get = db.prepare('SELECT * FROM connectors WHERE id = ?');
  const agentsOf = db.prepare('SELECT agent_id FROM connector_scope_agents WHERE connector_id = ? ORDER BY position');
  const insert = db.prepare(
    `INSERT INTO connectors (id, label, label_key, setup, enabled, connected, scope_mode, scope_revision, scope_review_required, created_at, updated_at)
     VALUES (:id, :label, :labelKey, :setup, :enabled, :connected, :mode, 0, 0, :createdAt, :updatedAt)`,
  );
  const insertAgent = db.prepare('INSERT INTO connector_scope_agents (connector_id, agent_id, position) VALUES (?, ?, ?)');
  const clearAgents = db.prepare('DELETE FROM connector_scope_agents WHERE connector_id = ?');
  const updateAccount = db.prepare(
    `UPDATE connectors SET label = :label, label_key = :labelKey, setup = :setup, updated_at = :updatedAt,
       scope_review_required = MAX(scope_review_required, :review), scope_revision = scope_revision + :review
     WHERE id = :id`,
  );
  const setEnabled = db.prepare('UPDATE connectors SET enabled = ?, updated_at = ? WHERE id = ?');
  const setConnected = db.prepare('UPDATE connectors SET connected = ?, updated_at = ? WHERE id = ?');
  const setScope = db.prepare('UPDATE connectors SET scope_mode = ?, scope_revision = ?, scope_review_required = 0, updated_at = ? WHERE id = ?');
  const remove = db.prepare('DELETE FROM connectors WHERE id = ?');

  const parse = (row: unknown): ConnectorRecord => {
    const parsed = ConnectorRow.parse(row);
    const agentIds = agentsOf.all(parsed.id).map((each) => AgentRow.parse(each).agent_id);
    return {
      id: parsed.id,
      label: parsed.label,
      labelKey: parsed.label_key,
      setup: parsed.setup,
      enabled: parsed.enabled,
      connected: parsed.connected,
      scope: ConnectorScope.parse({ mode: parsed.scope_mode, agentIds, revision: parsed.scope_revision, scopeReviewRequired: parsed.scope_review_required }),
      createdAt: parsed.created_at,
      updatedAt: parsed.updated_at,
    };
  };
  const read = (id: string): ConnectorRecord | undefined => {
    const row = get.get(id);
    return row === undefined ? undefined : parse(row);
  };
  const writeAgents = (statement: StatementSync, id: string, agentIds: readonly string[]): void => {
    for (const [position, agentId] of agentIds.entries()) statement.run(id, agentId, position);
  };
  const inTransaction = <T>(work: () => T): T => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };

  return {
    list: () => list.all().map(parse),
    get: read,
    insert: (connector) => {
      try {
        inTransaction(() => {
          insert.run({
            id: connector.id,
            label: connector.label,
            labelKey: connector.labelKey,
            setup: JSON.stringify(connector.setup),
            enabled: connector.enabled ? 1 : 0,
            connected: connector.connected ? 1 : 0,
            mode: connector.scope.mode,
            createdAt: connector.createdAt,
            updatedAt: connector.updatedAt,
          });
          writeAgents(insertAgent, connector.id, connector.scope.mode === 'selected' ? connector.scope.agentIds : []);
        });
        return 'saved';
      } catch (error) {
        if (isUniqueViolation(error)) return 'label-taken';
        throw error;
      }
    },
    updateAccount: (id, account) => {
      try {
        const changes = updateAccount.run({
          id,
          label: account.label,
          labelKey: account.labelKey,
          setup: JSON.stringify(account.setup),
          updatedAt: account.updatedAt,
          review: account.scopeReviewRequired ? 1 : 0,
        }).changes;
        return changes > 0 ? 'saved' : 'not-found';
      } catch (error) {
        if (isUniqueViolation(error)) return 'label-taken';
        throw error;
      }
    },
    setEnabled: (id, enabled, updatedAt) => setEnabled.run(enabled ? 1 : 0, updatedAt, id).changes > 0,
    setConnected: (id, connected, updatedAt) => setConnected.run(connected ? 1 : 0, updatedAt, id).changes > 0,
    setScope: (id, expectedRevision, scope, updatedAt) =>
      inTransaction((): ScopeWrite => {
        const current = read(id);
        if (current === undefined) return { kind: 'not-found' };
        if (current.scope.revision !== expectedRevision) return { kind: 'conflict', current: current.scope };
        clearAgents.run(id);
        writeAgents(insertAgent, id, scope.mode === 'selected' ? scope.agentIds : []);
        setScope.run(scope.mode, expectedRevision + 1, updatedAt, id);
        return { kind: 'saved' };
      }),
    delete: (id) => remove.run(id).changes > 0,
  };
}
