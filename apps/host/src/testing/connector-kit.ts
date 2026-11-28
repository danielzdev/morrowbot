import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connector, type ConnectorSetup, type CreateConnectorRequest } from '@morrowbot/contracts';
import { startToolServer, type ToolServer } from '../features/agent-tools/index.ts';
import { createConnectorRuntime, createConnectorService, type ConnectorService } from '../features/connectors/index.ts';
import { openStorage, type Storage } from '../features/storage/index.ts';
import { postMcp } from './host-tools-client.ts';
import { sequence } from './test-host.ts';

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
      { name: 'FIXTURE_ACCOUNT', value: account },
      { name: 'FIXTURE_LOG', value: log },
      { name: 'FIXTURE_TOKEN', value: FIXTURE_TOKEN },
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
  readonly tools: ToolServer;
  readonly errors: unknown[];
  /** Saves the connector, waits for its session to settle, and gives its id. */
  add(request: CreateConnectorRequest): Promise<string>;
  view(id: string): Connector;
  turn(agentId: string): KitTurn;
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
      createdAt: now(),
      updatedAt: now(),
    });
  }
  const errors: unknown[] = [];
  const report = (error: unknown): void => {
    errors.push(error);
  };
  const connectors = createConnectorService({
    store: storage.connectors,
    runtime: createConnectorRuntime({ path: process.env.PATH ?? '/usr/bin:/bin', version: '0.0.0-test' }),
    safeMode: options.safeMode ?? false,
    agentExists: (id) => storage.agents.get(id) !== undefined,
    sharedWithMembers: (agentId) => storage.members.allowlistsOf(agentId).length > 0,
    newId,
    now,
    report,
  });
  const tools = await startToolServer({
    ports: {
      agents: { list: () => storage.agents.list() },
      messages: { get: () => undefined, send: () => ({ kind: 'refused', reason: 'Messages are not part of connector tests' }) },
      memories: { list: () => undefined, create: () => undefined, update: () => undefined, delete: () => false },
      connectors: { tools: (agentId) => connectors.toolsFor(agentId), call: (agentId, name, args, signal) => connectors.call(agentId, name, args, signal) },
    },
    version: '0.0.0-test',
    report,
  });
  let turns = 0;
  return {
    dir,
    storage,
    connectors,
    tools,
    errors,
    add: async (request) => {
      const saved = connectors.create(request);
      if (saved.kind !== 'saved') throw new Error(`not saved: ${saved.kind}`);
      await connectors.settled(saved.connector.id);
      return saved.connector.id;
    },
    view: (id) => Connector.parse(connectors.get(id)),
    turn: (agentId) => {
      const turnId = `turn-${String(++turns)}`;
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
