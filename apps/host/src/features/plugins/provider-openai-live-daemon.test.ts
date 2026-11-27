import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CODEX_PATH, rawCodex, type RawCodex } from '../../testing/codex-live.ts';

/**
 * The §5 provider-openai checks of the pinned Codex itself, on a bare `codex app-server` with your
 * own `~/.codex`. They start threads but send no prompt, so they spend nothing; they still need
 * `MORROWBOT_LIVE_CODEX=1`. `MORROWBOT_PIN_CODEX_SCHEMA=1` rewrites the pinned schema instead of
 * comparing it.
 */
const LIVE = process.env.MORROWBOT_LIVE_CODEX === '1';
const PINNED = fileURLToPath(new URL('../../../../../plugins/provider-openai/schema/pinned.json', import.meta.url));

/** The generated definitions the plugin reads or sends, with everything they refer to. */
const ROOTS = [
  'GetAccountResponse', 'ConfigReadParams', 'GetAccountRateLimitsResponse', 'ModelListResponse', 'ThreadStartParams', 'ThreadStartResponse',
  'ThreadResumeParams', 'ThreadResumeResponse', 'TurnStartParams', 'TurnStartResponse', 'TurnInterruptParams', 'ThreadUnsubscribeParams',
  'ThreadUnsubscribeResponse', 'ThreadLoadedListResponse', 'ListMcpServerStatusResponse', 'HooksListResponse', 'ThreadTokenUsageUpdatedNotification',
  'TurnCompletedNotification', 'AgentMessageDeltaNotification', 'ItemStartedNotification', 'ItemCompletedNotification', 'ErrorNotification',
  'ModelReroutedNotification', 'AccountRateLimitsUpdatedNotification',
];

const Bundle = z.looseObject({ definitions: z.record(z.string(), z.unknown()) });

let root = '';
let codex: RawCodex | undefined;

beforeEach(async () => {
  if (!LIVE) return;
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-live-codex-')));
});

afterEach(async () => {
  if (!LIVE) return;
  codex?.close();
  codex = undefined;
  await rm(root, { recursive: true, force: true });
});

function referenced(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) for (const each of value) referenced(each, into);
  else if (typeof value === 'object' && value !== null) {
    for (const [key, each] of Object.entries(value)) {
      if (key === '$ref' && typeof each === 'string') into.add(each.split('/').at(-1) ?? each);
      else referenced(each, into);
    }
  }
}

/** One definition per line, sorted, so a version bump diffs per definition. */
async function generatedSubset(): Promise<string> {
  const out = path.join(root, 'schema');
  const generated = spawnSync(CODEX_PATH, ['app-server', 'generate-json-schema', '--experimental', '--out', out], { encoding: 'utf8' });
  if (generated.status !== 0) throw new Error(generated.stderr);
  const { definitions } = Bundle.parse(JSON.parse(await readFile(path.join(out, 'codex_app_server_protocol.v2.schemas.json'), 'utf8')));
  const keep = new Set<string>();
  const todo = [...ROOTS];
  for (let name = todo.pop(); name !== undefined; name = todo.pop()) {
    if (keep.has(name) || !(name in definitions)) continue;
    keep.add(name);
    const refs = new Set<string>();
    referenced(definitions[name], refs);
    todo.push(...refs);
  }
  const missing = ROOTS.filter((name) => !keep.has(name));
  if (missing.length > 0) throw new Error(`the generated schema has no ${missing.join(', ')}`);
  return `${[...keep].sort().map((name) => JSON.stringify({ [name]: definitions[name] })).join('\n')}\n`;
}

const Opened = z.looseObject({
  thread: z.looseObject({ id: z.string() }),
  sandbox: z.looseObject({ type: z.string() }),
  approvalPolicy: z.unknown(),
  instructionSources: z.array(z.string()),
});
const Servers = z.looseObject({ data: z.array(z.looseObject({ name: z.string(), runtimeStatus: z.string().optional() })) });
const Hooks = z.looseObject({ data: z.array(z.looseObject({ hooks: z.array(z.unknown()) })) });
const Loaded = z.looseObject({ data: z.array(z.string()) });
const Config = z.looseObject({ config: z.looseObject({ model_provider: z.unknown(), openai_base_url: z.unknown(), mcp_servers: z.record(z.string(), z.unknown()).nullish() }) });

describe.skipIf(!LIVE)('provider-openai on the pinned Codex', () => {
  it('generates the pinned experimental schema for every shape the plugin reads or sends', async () => {
    const subset = await generatedSubset();
    if (process.env.MORROWBOT_PIN_CODEX_SCHEMA === '1') await writeFile(PINNED, subset);
    expect(subset === (await readFile(PINNED, 'utf8'))).toBe(true);
  });

  it('opens a locked-down thread: read-only without approvals, no MCP server or hook running, and the cwd AGENTS.md loaded; unsubscribe unloads it', async () => {
    const cwd = path.join(root, 'work');
    await mkdir(path.join(cwd, '.git'), { recursive: true });
    await writeFile(path.join(cwd, 'AGENTS.md'), 'Canary instructions for the live fixture.\n');
    codex = await rawCodex();
    const { config } = Config.parse(await codex.call('config/read', { includeLayers: false, cwd }));
    const servers = Object.keys(config.mcp_servers ?? {});
    const overrides = {
      'features.shell_tool': false,
      'features.unified_exec': false,
      'features.apps': false,
      'features.plugins': false,
      'features.codex_hooks': false,
      ...Object.fromEntries(servers.map((name) => [`mcp_servers.${name}.enabled`, false])),
    };
    const opened = Opened.parse(await codex.call('thread/start', { cwd, sandbox: 'read-only', approvalPolicy: 'never', config: overrides, ephemeral: true }));
    const threadId = opened.thread.id;
    const running = Servers.parse(await codex.call('mcpServerStatus/list', { threadId, limit: 1000 })).data.filter((server) => server.runtimeStatus !== 'disabled');
    const hooks = Hooks.parse(await codex.call('hooks/list', { threadId })).data.flatMap((entry) => entry.hooks);
    const loadedBefore = Loaded.parse(await codex.call('thread/loaded/list', {})).data.includes(threadId);
    await codex.call('thread/unsubscribe', { threadId });
    let loadedAfter = true;
    for (let tries = 0; tries < 30 && loadedAfter; tries += 1) {
      await new Promise((done) => setTimeout(done, 100));
      loadedAfter = Loaded.parse(await codex.call('thread/loaded/list', {})).data.includes(threadId);
    }
    expect({
      sandbox: opened.sandbox.type,
      approvalPolicy: opened.approvalPolicy,
      running: running.map((server) => server.name),
      hooks: hooks.length,
      cwdInstructions: opened.instructionSources.includes(path.join(cwd, 'AGENTS.md')),
      loadedBefore,
      loadedAfter,
    }).toEqual({ sandbox: 'readOnly', approvalPolicy: 'never', running: [], hooks: 0, cwdInstructions: true, loadedBefore: true, loadedAfter: false });
  });

  it('ignores a project-local route override: config/read in that folder still shows the built-in route', async () => {
    const cwd = path.join(root, 'project');
    await mkdir(path.join(cwd, '.git'), { recursive: true });
    await mkdir(path.join(cwd, '.codex'));
    await writeFile(path.join(cwd, '.codex', 'config.toml'), 'model_provider = "elsewhere"\nopenai_base_url = "https://gateway.example.com/v1"\n');
    codex = await rawCodex();
    const plain = Config.parse(await codex.call('config/read', { includeLayers: false, cwd: root })).config;
    const project = Config.parse(await codex.call('config/read', { includeLayers: false, cwd })).config;
    expect({ provider: project.model_provider, url: project.openai_base_url }).toEqual({ provider: plain.model_provider, url: plain.openai_base_url });
  });
});
