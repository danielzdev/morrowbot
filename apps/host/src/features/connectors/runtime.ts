import type { ConnectorSetup } from '@morrowbot/contracts';
import { McpFailure, type FailureKind } from './channel.ts';
import { startSession, type McpCallResult, type McpSession, type McpTool } from './mcp-session.ts';
import { offeredTools, openChannel } from './reach.ts';
import { hideRecord, hideSecrets, hideVaultValues, reachOf, type VaultLookup } from './secrets.ts';

/** Where one connector's connection stands. `failed` keeps why, for its status pill. */
export type RuntimeState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'ready'; readonly tools: readonly McpTool[] }
  | { readonly kind: 'failed'; readonly failure: Exclude<FailureKind, 'aborted' | 'rpc'>; readonly message: string };

/** The live MCP sessions of every connected connector, by connector id. */
export interface ConnectorRuntime {
  state(id: string): RuntimeState;
  /** (Re)starts the connector's session, reading its Vault items now; settles once it is ready or failed. */
  connect(id: string, setup: ConnectorSetup): Promise<void>;
  /** Stops the session (a local server's whole process group) and forgets it. */
  disconnect(id: string): Promise<void>;
  /** Calls a tool by its server name. Rejects with an `McpFailure`; a lost connection also marks the connector failed. */
  call(id: string, toolName: string, args: unknown, signal: AbortSignal): Promise<McpCallResult>;
  closeAll(): Promise<void>;
}

interface Slot {
  readonly hide: (text: string) => string;
  /** Hides only values read from the Vault: for tool results and descriptions. */
  readonly hideVault: (text: string) => string;
  /** Bumped on every connect and disconnect, so a session that settles late knows it is stale. */
  readonly attempt: number;
  readonly state: RuntimeState;
  readonly session: McpSession | null;
  readonly stop: AbortController;
}

const LOST: readonly FailureKind[] = ['auth', 'unreachable', 'exited'];

export function createConnectorRuntime(options: { readonly path: string; readonly version: string; readonly vault: VaultLookup }): ConnectorRuntime {
  const slots = new Map<string, Slot>();
  let attempts = 0;

  const release = async (slot: Slot | undefined): Promise<void> => {
    if (slot === undefined) return;
    slot.stop.abort();
    await slot.session?.close();
  };
  const fail = (id: string, attempt: number, failure: McpFailure): void => {
    const slot = slots.get(id);
    if (slot?.attempt !== attempt || failure.kind === 'aborted' || failure.kind === 'rpc') return;
    slots.set(id, { ...slot, state: { kind: 'failed', failure: failure.kind, message: slot.hide(failure.message) }, session: null });
    void slot.session?.close();
  };

  return {
    state: (id) => slots.get(id)?.state ?? { kind: 'idle' },
    connect: async (id, setup) => {
      const previous = slots.get(id);
      const attempt = ++attempts;
      const stop = new AbortController();
      slots.set(id, { attempt, state: { kind: 'starting' }, session: null, stop, hide: (text) => text, hideVault: (text) => text });
      await release(previous);
      const reached = await reachOf(setup, options.vault);
      if (reached.kind === 'refused') {
        fail(id, attempt, new McpFailure('auth', reached.message));
        return;
      }
      const { reach } = reached;
      const hide = (text: string): string => hideSecrets(reach, text);
      const hideVault = (text: string): string => hideVaultValues(reach, text);
      const current = slots.get(id);
      if (current?.attempt !== attempt) return;
      slots.set(id, { ...current, hide, hideVault });
      let session: McpSession;
      try {
        const channel = openChannel(reach, options.path);
        channel.onEnd((failure) => {
          fail(id, attempt, failure);
        });
        session = await startSession(channel, options.version, stop.signal);
      } catch (error) {
        const failure = error instanceof McpFailure ? error : new McpFailure('unreachable', 'The connector could not start');
        fail(id, attempt, failure.kind === 'rpc' ? new McpFailure('protocol', failure.message) : failure);
        return;
      }
      if (slots.get(id)?.attempt !== attempt) {
        await session.close();
        return;
      }
      const tools = offeredTools(setup, session.tools).map((tool) => ({ name: tool.name, description: hideVault(tool.description), inputSchema: hideRecord(tool.inputSchema, hideVault) }));
      slots.set(id, { attempt, state: { kind: 'ready', tools }, session, stop, hide, hideVault });
    },
    disconnect: async (id) => {
      const slot = slots.get(id);
      slots.delete(id);
      await release(slot);
    },
    call: async (id, toolName, args, signal) => {
      const slot = slots.get(id);
      if (slot === undefined || slot.session === null || slot.state.kind !== 'ready') throw new McpFailure('unreachable', 'The connector is not connected');
      const session = slot.session;
      try {
        const result = await session.call(toolName, args, signal);
        return {
          content: result.content.map((block) => hideRecord(block, slot.hideVault)),
          structuredContent: result.structuredContent === null ? null : hideRecord(result.structuredContent, slot.hideVault),
          isError: result.isError,
        };
      } catch (error) {
        const failure = error instanceof McpFailure ? error : new McpFailure('unreachable', 'The tool call failed');
        if (LOST.includes(failure.kind)) fail(id, slot.attempt, failure);
        throw new McpFailure(failure.kind, slot.hide(failure.message));
      }
    },
    closeAll: async () => {
      const all = [...slots.values()];
      slots.clear();
      await Promise.all(all.map(release));
    },
  };
}
