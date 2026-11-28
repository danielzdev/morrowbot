import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connector, type ConnectorSetup, type CreateConnectorRequest } from '@morrowbot/contracts';
import { startToolServer, type ToolGrant, type ToolServer } from '../features/agent-tools/index.ts';
import { createConnectorRuntime, createConnectorService, type ConnectorService, type TurnOf } from '../features/connectors/index.ts';
import { openStorage, type Storage } from '../features/storage/index.ts';
import { keyValue, openVault, vaultBackend, type VaultService } from '../features/vault/index.ts';
import { postMcp } from './host-tools-client.ts';
import { sequence } from './test-host.ts';


const NO_SUBAGENTS: { readonly kind: 'refused'; readonly reason: string } = { kind: 'refused', reason: 'Sub-agents are not part of connector tests' };
export const STDIO_SERVER = fileURLToPath(new URL('./mcp-stdio-server.ts', import.meta.url));

/** The secret every fixture stdio server is given; `echo` with text `leak` answers with an error quoting it. */
export const FIXTURE_TOKEN = 'fixture-token-123';

/** A local stdio connector running the fixture server as `account`, logging to `log`. */
export function stdioSetup(account: string, log: string): ConnectorSetup {
  return {
    kind: 'stdio',
    command: process.execPath,
    args: [STDIO_SERVER],
    env: [
      { kind: 'inline', name: 'FIXTURE_ACCOUNT', value: account },
      { kind: 'inline', name: 'FIXTURE_LOG', value: log },
      { kind: 'inline', name: 'FIXTURE_TOKEN', value: FIXTURE_TOKEN },
    ],
  };
}

/** One running turn's view of the host's MCP server. */
export interface KitTurn {
  readonly turnId: string;
  list(): Promise<unknown>;
  call(name: string, args?: object): Promise<unknown>;
  end(): void;
}

/** Real storage, connector service and agent tool server, with agents `agentIds` saved, for connector tests. */
export interface ConnectorKit {
  readonly dir: string;
  readonly storage: Storage;
  readonly connectors: ConnectorService;
  /** A real vault (its key in a file in `dir`) that connectors read their Vault items from. */
  readonly vault: VaultService;
  readonly tools: ToolServer;
  readonly errors: unknown[];
  /** Saves the connector, waits for its session to settle, and gives its id. */
  add(request: CreateConnectorRequest): Promise<string>;
  view(id: string): Connector;
  /** A running turn of `agentId`, started by the server owner unless `startedBy` says otherwise. */
  turn(agentId: string, startedBy?: TurnOf['startedBy']): KitTurn;
  close(): Promise<void>;
}

export async function startConnectorKit(options: { readonly agentIds: readonly string[]; readonly safeMode?: boolean }): Promise<ConnectorKit> {
  const dir = await mkdtemp(path.join(tmpdir(), 'morrowbot-connectors-'));
  const { newId, now } = sequence();
  const storage = openStorage(path.join(dir, 'morrowbot.sqlite'), now);
  for (const id of options.agentIds) {
    storage.agents.insert({
      id,
      name: id,
      description: '',
      workspace: { kind: 'shared', dir: '/work' },
      avatar: { kind: 'bot', shape: 'mug', color: '#112233', finish: 'metallic' },
      provider: { kind: 'unbound' },
      folderId: null,
      emojiReplies: 'allowed',
      disabledExtensions: [],
      revision: 0,
      createdAt: now(),
      updatedAt: now(),
    });
  }
  const errors: unknown[] = [];
  const report = (error: unknown): void => {
    errors.push(error);
  };
  const vault = await openVault({ file: path.join(dir, 'vault.json'), secrets: (await vaultBackend('file', process.platform, dir)).secrets, newId, now, report });
  const connectors = createConnectorService({
    store: storage.connectors,
    runtime: createConnectorRuntime({ path: process.env.PATH ?? '/usr/bin:/bin', version: '0.0.0-test', vault: (vaultId) => keyValue(vault, vaultId) }),
    safeMode: options.safeMode ?? false,
    agentExists: (id) => storage.agents.get(id) !== undefined,
    sharedWithMembers: (agentId) => storage.members.allowlistsOf(agentId).length > 0,
    newId,
    now,
    report,
  });
  const starters = new Map<string, TurnOf['startedBy']>();
  const turnOf = (grant: ToolGrant): TurnOf => ({ agentId: grant.agentId, startedBy: starters.get(grant.turnId) ?? 'member' });
  const tools = await startToolServer({
    ports: {
      agents: { list: () => storage.agents.list() },
      messages: { get: () => undefined, send: () => ({ kind: 'refused', reason: 'Messages are not part of connector tests' }) },
      memories: { list: () => undefined, create: () => undefined, update: () => undefined, delete: () => false },
      replies: { react: () => ({ kind: 'refused', reason: 'Replies are not part of connector tests' }), stayQuiet: () => ({ kind: 'refused', reason: 'Replies are not part of connector tests' }), attachRefusal: () => 'Replies are not part of connector tests' },
      replyAttachments: { attach: () => Promise.resolve({ attached: [], refused: [] }) },
      cards: { propose: () => Promise.resolve({ kind: 'refused', reason: 'Cards are not part of connector tests' }), searchMarketplace: () => Promise.resolve({ kind: 'refused', reason: 'Cards are not part of connector tests' }), sharedWithMembers: () => false },
      vault: { list: () => [] },
      connectors: {
        tools: (grant) => connectors.toolsFor(turnOf(grant)),
        call: (grant, name, args, signal) => connectors.call(turnOf(grant), name, args, signal),
      },
      subagents: {
        isSubagent: () => false,
        spawn: () => Promise.resolve(NO_SUBAGENTS),
        wait: () => Promise.resolve(NO_SUBAGENTS),
        list: () => Promise.resolve(NO_SUBAGENTS),
      },
    },
    version: '0.0.0-test',
    report,
  });
  let turns = 0;
  return {
    dir,
    storage,
    connectors,
    vault,
    tools,
    errors,
    add: async (request) => {
      const saved = connectors.create(request);
      if (saved.kind !== 'saved') throw new Error(`not saved: ${saved.kind}`);
      await connectors.settled(saved.connector.id);
      return saved.connector.id;
    },
    view: (id) => Connector.parse(connectors.get(id)),
    turn: (agentId, startedBy = 'owner') => {
      const turnId = `turn-${String(++turns)}`;
      starters.set(turnId, startedBy);
      const open = tools.open({ turnId, agentId, threadId: `thread-${agentId}` });
      if (open.kind !== 'mcp') throw new Error('no tools');
      let id = 0;
      const post = async (method: string, params: object): Promise<unknown> => (await postMcp(open.url, open.token, { jsonrpc: '2.0', id: ++id, method, params })).body;
      return {
        turnId,
        list: () => post('tools/list', {}),
        call: (name, args = {}) => post('tools/call', { name, arguments: args }),
        end: () => {
          tools.close(turnId);
        },
      };
    },
    close: async () => {
      await tools.stop();
      await connectors.close();
      storage.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Only the connector tools' names from a `tools/list` answer. */
export function connectorToolNames(answer: unknown): string[] {
  const tools = typeof answer === 'object' && answer !== null && 'result' in answer ? answer.result : undefined;
  const list = typeof tools === 'object' && tools !== null && 'tools' in tools && Array.isArray(tools.tools) ? tools.tools : [];
  return list.flatMap((tool: unknown) => (typeof tool === 'object' && tool !== null && 'name' in tool && typeof tool.name === 'string' && tool.name.includes('__') ? [tool.name] : []));
}
