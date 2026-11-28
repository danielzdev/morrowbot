import {
  connectorLabelKey,
  type Connector,
  type ConnectorScope,
  type CreateConnectorRequest,
  type SetConnectorScopeRequest,
  type UpdateConnectorAccountRequest,
} from '@morrowbot/contracts';
import { keepsSecrets, mergeSetup, targetOf } from './account.ts';
import { agentTools, callAgentTool, type AccessContext } from './agent-access.ts';
import { bindTools } from './bindings.ts';
import type { AgentConnectorCall, AgentConnectorTool, ConnectorStore, ScopeChoice, StoredConnector } from './ports.ts';
import type { ConnectorRuntime } from './runtime.ts';
import { connectorStatus, setupView } from './status.ts';

export type ConnectorSave =
  | { readonly kind: 'saved'; readonly connector: Connector }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'label-taken' }
  | { readonly kind: 'invalid'; readonly reason: string };

export type ScopeSave =
  | { readonly kind: 'saved'; readonly connector: Connector }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'conflict'; readonly current: ConnectorScope }
  | { readonly kind: 'invalid'; readonly reason: string };

export interface ConnectorService {
  readonly safeMode: boolean;
  list(): Connector[];
  get(id: string): Connector | undefined;
  /** Saves the connector with its chosen scope, then connects it. */
  create(request: CreateConnectorRequest): ConnectorSave;
  /** Renames, or points the connector elsewhere (which reconnects it, and pauses a Selected scope for review). */
  updateAccount(id: string, request: UpdateConnectorAccountRequest): ConnectorSave;
  setEnabled(id: string, enabled: boolean): Connector | undefined;
  /** Writes the scope only at the revision the caller read; a saved scope clears a pending review. */
  setScope(id: string, request: SetConnectorScopeRequest): ScopeSave;
  /** Connect, or Reconnect. Like every change here, the session starts in the background: see `settled`. */
  connect(id: string): Connector | undefined;
  /** Drops the session (stopping a local server), keeping setup and scope. */
  disconnect(id: string): Connector | undefined;
  remove(id: string): Promise<boolean>;
  /** Settles once the connector's latest connect or disconnect has. */
  settled(id: string): Promise<void>;
  /** Starts connecting every connector that is on and connected (none in safe mode). */
  start(): void;
  close(): Promise<void>;
  /** The connector tools an agent's turn lists. */
  toolsFor(agentId: string): AgentConnectorTool[];
  /** Calls one of them, rechecking that connector's scope and status first. */
  call(agentId: string, name: string, args: unknown, signal: AbortSignal): Promise<AgentConnectorCall>;
}

export interface ConnectorServiceOptions {
  readonly store: ConnectorStore;
  readonly runtime: ConnectorRuntime;
  readonly safeMode: boolean;
  readonly agentExists: (id: string) => boolean;
  readonly sharedWithMembers: AccessContext['sharedWithMembers'];
  readonly newId: () => string;
  readonly now: () => string;
  readonly report: (error: unknown) => void;
}

export function createConnectorService(options: ConnectorServiceOptions): ConnectorService {
  const { store, runtime, safeMode } = options;
  const access: AccessContext = { safeMode, sharedWithMembers: options.sharedWithMembers, runtime };

  const view = (record: StoredConnector): Connector => {
    const state = runtime.state(record.id);
    const tools = state.kind === 'ready' ? bindTools(record, state.tools) : [];
    return {
      id: record.id,
      label: record.label,
      labelKey: record.labelKey,
      setup: setupView(record.setup),
      enabled: record.enabled,
      connected: record.connected,
      scope: record.scope,
      status: connectorStatus({ safeMode, enabled: record.enabled, connected: record.connected, scope: record.scope, runtime: state, toolCount: tools.length }),
      tools: tools.map(({ toolName, boundName, description }) => ({ name: toolName, boundName, description })),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  };
  const viewOf = (id: string): Connector | undefined => {
    const record = store.get(id);
    return record === undefined ? undefined : view(record);
  };
  const unknownAgent = (scope: ScopeChoice): string | undefined => scope.agentIds.find((id) => !options.agentExists(id));
  const syncing = new Map<string, Promise<void>>();
  /** Starts or stops the session to match the saved record; `settled(id)` waits for it. */
  const sync = (id: string): void => {
    const record = store.get(id);
    const work = record === undefined || safeMode || !record.enabled || !record.connected ? runtime.disconnect(id) : runtime.connect(id, record.setup);
    const tracked = work.catch(options.report).finally(() => {
      if (syncing.get(id) === tracked) syncing.delete(id);
    });
    syncing.set(id, tracked);
  };

  return {
    safeMode,
    list: () => store.list().map(view),
    get: viewOf,
    create: (request) => {
      const missing = unknownAgent(request.scope);
      if (missing !== undefined) return { kind: 'invalid', reason: `scope.agentIds: no agent ${missing}` };
      const id = options.newId();
      const at = options.now();
      const saved = store.insert({
        id,
        label: request.label,
        labelKey: connectorLabelKey(request.label),
        setup: request.setup,
        enabled: true,
        connected: true,
        scope: request.scope,
        createdAt: at,
        updatedAt: at,
      });
      if (saved === 'label-taken') return { kind: 'label-taken' };
      sync(id);
      const connector = viewOf(id);
      return connector === undefined ? { kind: 'not-found' } : { kind: 'saved', connector };
    },
    updateAccount: (id, request) => {
      const record = store.get(id);
      if (record === undefined) return { kind: 'not-found' };
      const merged = mergeSetup(record.setup, request.setup);
      if (merged.kind === 'invalid') return merged;
      const retargeted = targetOf(merged.setup) !== targetOf(record.setup);
      if (retargeted && keepsSecrets(request.setup)) return { kind: 'invalid', reason: 'This points the connector somewhere new: enter its keys and secret values again.' };
      const saved = store.updateAccount(id, {
        label: request.label,
        labelKey: connectorLabelKey(request.label),
        setup: merged.setup,
        scopeReviewRequired: retargeted && record.scope.mode === 'selected',
        updatedAt: options.now(),
      });
      if (saved !== 'saved') return { kind: saved };
      if (JSON.stringify(merged.setup) !== JSON.stringify(record.setup)) sync(id);
      const connector = viewOf(id);
      return connector === undefined ? { kind: 'not-found' } : { kind: 'saved', connector };
    },
    setEnabled: (id, enabled) => {
      if (!store.setEnabled(id, enabled, options.now())) return undefined;
      sync(id);
      return viewOf(id);
    },
    setScope: (id, request) => {
      const missing = unknownAgent(request);
      if (missing !== undefined) return { kind: 'invalid', reason: `agentIds: no agent ${missing}` };
      const written = store.setScope(id, request.revision, { mode: request.mode, agentIds: request.agentIds }, options.now());
      if (written.kind !== 'saved') return written;
      const connector = viewOf(id);
      return connector === undefined ? { kind: 'not-found' } : { kind: 'saved', connector };
    },
    connect: (id) => {
      if (!store.setConnected(id, true, options.now())) return undefined;
      sync(id);
      return viewOf(id);
    },
    disconnect: (id) => {
      if (!store.setConnected(id, false, options.now())) return undefined;
      sync(id);
      return viewOf(id);
    },
    remove: async (id) => {
      const removed = store.delete(id);
      await runtime.disconnect(id);
      return removed;
    },
    settled: async (id) => {
      await syncing.get(id);
    },
    start: () => {
      for (const { id } of store.list()) sync(id);
    },
    close: async () => {
      await runtime.closeAll();
      await Promise.all(syncing.values());
    },
    toolsFor: (agentId) => agentTools(store.list(), agentId, access),
    call: (agentId, name, args, signal) => callAgentTool(store.list(), agentId, name, args, signal, access),
  };
}
