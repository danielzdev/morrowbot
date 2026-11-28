import type { ApiError, Connector, ConnectorList, ConnectorScope, CreateConnectorRequest, SetConnectorScopeRequest, UpdateConnectorAccountRequest, VaultItemList } from '@morrowbot/contracts';
import type { z } from 'zod';
import type { MorrowbotBridge } from '../../bridge.ts';
import type { Api, ApiResult } from '../../shared/api.ts';
import { Store, type Loadable } from '../../shared/store.ts';

export type ConnectorWork = 'switching' | 'connecting' | 'disconnecting' | 'removing';

/** What the user started on each connector and why it did not work, by connector id. */
export interface ConnectorActivity {
  readonly busy: Readonly<Record<string, ConnectorWork>>;
  readonly problems: Readonly<Record<string, string>>;
}

/** What the Connectors tab shows beside its list. */
export type ConnectorPane =
  | { readonly kind: 'default' }
  | { readonly kind: 'connector'; readonly id: string }
  | { readonly kind: 'adding'; readonly form: 'mcp' | 'composio' };

export interface ConnectorsPlace {
  readonly pane: ConnectorPane;
  /** Bumped by every `open`, so a detail opened again starts without old drafts. */
  readonly visit: number;
  /** The agent whose settings sent the user here: adding a connector starts with it ticked. */
  readonly installFor: string | null;
}

/** Where another screen sends the user: one connector, or the list with an agent to add connectors for. */
export type ConnectorTarget = { readonly kind: 'connector'; readonly id: string } | { readonly kind: 'list'; readonly installFor: string };

/** Why a create or an account change was refused, and whether the label is what to fix. */
export interface Refusal {
  readonly kind: 'refused';
  readonly field: 'label' | 'form';
  readonly message: string;
}

export type Created = { readonly kind: 'created'; readonly connector: Connector } | Refusal;
export type AccountSaved = { readonly kind: 'saved' } | Refusal;
export type ScopeSaved =
  | { readonly kind: 'saved' }
  | { readonly kind: 'conflict'; readonly current: ConnectorScope }
  | { readonly kind: 'refused'; readonly message: string };

/** The host's connectors (spec IA §3), shared by Extensions › Connectors and Agent Settings › Extensions. */
export interface ConnectorsModel {
  readonly list: Store<Loadable<ConnectorList>>;
  readonly activity: Store<ConnectorActivity>;
  readonly place: Store<ConnectorsPlace>;
  /** The Vault items a connector secret can be taken from, as of the last `loadVault`. */
  readonly vault: Store<Loadable<VaultItemList>>;
  load(): Promise<void>;
  /** Looks at the Vault again: the add form and the Account section call it when they open. */
  loadVault(): Promise<void>;
  create(request: z.input<typeof CreateConnectorRequest>): Promise<Created>;
  updateAccount(id: string, request: z.input<typeof UpdateConnectorAccountRequest>): Promise<AccountSaved>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  setScope(id: string, request: SetConnectorScopeRequest): Promise<ScopeSaved>;
  /** Takes the newer scope a conflict reported, without writing anything. */
  adoptScope(id: string, scope: ConnectorScope): void;
  connect(id: string): Promise<void>;
  disconnect(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  open(pane: ConnectorPane): void;
  /** Keeps showing this connector while it has unsaved changes, whatever the search leaves in the list. */
  pin(id: string): void;
  arrive(target: ConnectorTarget): void;
  /** The tab was left: an add form and its agent are forgotten. */
  leave(): void;
  close(): void;
}

export interface ConnectorsModelOptions {
  readonly api: Api;
  readonly bridge: Pick<MorrowbotBridge, 'onHostReady'>;
  readonly startingRefreshMs?: number;
}

const without = <T>(record: Readonly<Record<string, T>>, id: string): Readonly<Record<string, T>> => Object.fromEntries(Object.entries(record).filter(([key]) => key !== id));

/** A duplicate label is the host's only `conflict` here; a refused label otherwise says what to use instead. */
function refusal(error: ApiError['error']): Refusal {
  const label = error.kind === 'conflict' || error.message.includes('Use a short name');
  return { kind: 'refused', field: label ? 'label' : 'form', message: error.message };
}

export function createConnectorsModel(options: ConnectorsModelOptions): ConnectorsModel {
  const { api } = options;
  const list = new Store<Loadable<ConnectorList>>({ kind: 'loading' });
  const activity = new Store<ConnectorActivity>({ busy: {}, problems: {} });
  const place = new Store<ConnectorsPlace>({ pane: { kind: 'default' }, visit: 0, installFor: null });
  const vault = new Store<Loadable<VaultItemList>>({ kind: 'loading' });
  let loads = 0;
  let vaultLoads = 0;
  let asked = false;
  let closed = false;
  let startingTimer: ReturnType<typeof setTimeout> | undefined;

  /** A connector that is starting turns into something else shortly: look again until none is starting. */
  function watchStarting(): void {
    clearTimeout(startingTimer);
    const now = list.get();
    if (!closed && now.kind === 'loaded' && now.value.connectors.some(({ status }) => status.kind === 'starting')) {
      startingTimer = setTimeout(() => void load(), options.startingRefreshMs ?? 2_000);
    }
  }

  async function load(): Promise<void> {
    asked = true;
    const mine = ++loads;
    const result = await api.listConnectors();
    if (mine !== loads || closed) return;
    if (result.kind === 'ok') list.set({ kind: 'loaded', value: result.value });
    else if (list.get().kind !== 'loaded') list.set({ kind: 'failed', message: result.error.message });
    watchStarting();
  }

  function change(edit: (connectors: readonly Connector[]) => Connector[]): void {
    loads += 1;
    const now = list.get();
    if (now.kind !== 'loaded') {
      void load();
      return;
    }
    list.set({ kind: 'loaded', value: { ...now.value, connectors: edit(now.value.connectors) } });
    watchStarting();
  }

  function put(connector: Connector): void {
    change((all) => (all.some(({ id }) => id === connector.id) ? all.map((each) => (each.id === connector.id ? connector : each)) : [...all, connector]));
  }

  /** One of the row's own actions: busy until it returns, then the new connector or the reason it failed. */
  async function act<T>(id: string, work: ConnectorWork, call: () => Promise<ApiResult<T>>, done: (value: T) => void): Promise<void> {
    activity.update((now) => ({ busy: { ...now.busy, [id]: work }, problems: without(now.problems, id) }));
    const result = await call();
    if (closed) return;
    if (result.kind === 'ok') done(result.value);
    activity.update((now) => ({ busy: without(now.busy, id), problems: result.kind === 'ok' ? now.problems : { ...now.problems, [id]: result.error.message } }));
  }

  const stopRestarts = options.bridge.onHostReady(() => {
    if (asked) void load();
  });

  return {
    list,
    activity,
    place,
    vault,
    load,
    loadVault: async () => {
      const mine = ++vaultLoads;
      const result = await api.listVault();
      if (mine !== vaultLoads || closed) return;
      if (result.kind === 'ok') vault.set({ kind: 'loaded', value: result.value });
      else vault.set({ kind: 'failed', message: result.error.message });
    },
    create: async (request) => {
      const result = await api.createConnector(request);
      if (result.kind === 'failed') return refusal(result.error);
      put(result.value);
      return { kind: 'created', connector: result.value };
    },
    updateAccount: async (id, request) => {
      const result = await api.updateConnectorAccount(id, request);
      if (result.kind === 'failed') return refusal(result.error);
      put(result.value);
      activity.update((now) => ({ ...now, problems: without(now.problems, id) }));
      return { kind: 'saved' };
    },
    setEnabled: (id, enabled) => act(id, 'switching', () => api.setConnectorEnabled(id, enabled), put),
    setScope: async (id, request) => {
      const result = await api.setConnectorScope(id, request);
      if (result.kind === 'failed') {
        return result.error.kind === 'scope-conflict' ? { kind: 'conflict', current: result.error.current } : { kind: 'refused', message: result.error.message };
      }
      put(result.value);
      return { kind: 'saved' };
    },
    adoptScope: (id, scope) => {
      change((all) => all.map((each) => (each.id === id && scope.revision >= each.scope.revision ? { ...each, scope } : each)));
      void load();
    },
    connect: (id) => act(id, 'connecting', () => api.connectConnector(id), put),
    disconnect: (id) => act(id, 'disconnecting', () => api.disconnectConnector(id), put),
    remove: (id) =>
      act(
        id,
        'removing',
        async () => {
          const result = await api.removeConnector(id);
          return result.kind === 'failed' && result.status === 404 ? { kind: 'ok', value: null } : result;
        },
        () => {
          change((all) => all.filter((each) => each.id !== id));
        },
      ),
    open: (pane) => {
      place.update((now) => ({ ...now, pane, visit: now.visit + 1 }));
    },
    pin: (id) => {
      place.update((now) => (now.pane.kind === 'adding' ? now : { ...now, pane: { kind: 'connector', id } }));
    },
    arrive: (target) => {
      place.update((now) => ({
        pane: target.kind === 'connector' ? { kind: 'connector', id: target.id } : { kind: 'default' },
        visit: now.visit + 1,
        installFor: target.kind === 'list' ? target.installFor : null,
      }));
    },
    leave: () => {
      place.update((now) => ({ ...now, pane: now.pane.kind === 'adding' ? { kind: 'default' } : now.pane, installFor: null }));
    },
    close: () => {
      closed = true;
      clearTimeout(startingTimer);
      stopRestarts();
    },
  };
}
