#!/usr/bin/env node
/**
 * A stand-in for `codex` 0.171 that speaks the `app-server` JSON-RPC protocol over stdio, shaped
 * like the recorded real transcripts. It keeps its state in `$HOME/fake-codex/`: `state.json` holds
 * the account, config, managed requirements, rate-limit answer and hooks (read on every request, so a
 * test can change them; `openedProvider` makes every opened thread report that model provider);
 * `switch.json` (`{afterReads, state}`) merges `state` into `state.json` once that many more
 * `account/read`s have been answered; `threads.json` keeps saved threads across daemons; every request
 * is appended to `log.jsonl`. The prompt picks a turn's behavior: `stall` waits for `turn/interrupt`,
 * `ignore-interrupt` never ends, `tool` runs a command item, `ask` sends an approval request,
 * `fail-limit` fails on the usage limit, `hint` sends a rate-limit notification, `close-thread` replies
 * and then unloads the thread with `thread/closed`, `garbled` answers `turn/start` in an unknown shape
 * after a `turn/started` (with `silent`, without one and without running the turn); anything else replies.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';

const home = process.env.HOME ?? '/nonexistent';
const dir = path.join(home, 'fake-codex');
mkdirSync(dir, { recursive: true });
const file = (name: string): string => path.join(dir, name);

if (process.argv[2] === '--version') {
  process.stdout.write('codex-cli 0.171.0-alpha.13\n');
  process.exit(0);
}

const Json = z.record(z.string(), z.unknown());
const Totals = z.object({ inputTokens: z.number(), cachedInputTokens: z.number(), cacheWriteInputTokens: z.number(), outputTokens: z.number(), reasoningOutputTokens: z.number() });
type Totals = z.infer<typeof Totals>;
const Saved = z.record(z.string(), z.object({ total: Totals, lastTurn: z.string().nullable() }));
const State = z.object({
  account: Json,
  config: Json,
  rateLimits: Json,
  hooks: z.array(z.unknown()).default([]),
  accountError: z.string().nullable().default(null),
  keepLoaded: z.boolean().default(false),
  requirements: z.unknown().default(null),
  openedProvider: z.string().nullable().default(null),
});
const Switch = z.object({ afterReads: z.number(), state: Json });
const Message = z.looseObject({ id: z.union([z.number(), z.string()]).optional(), method: z.string().optional(), params: z.unknown().optional(), result: z.unknown().optional() });
const Params = z.looseObject({
  threadId: z.string().optional(),
  turnId: z.string().optional(),
  ephemeral: z.boolean().nullish(),
  modelProvider: z.string().nullish(),
  sandbox: z.string().nullish(),
  approvalPolicy: z.unknown().optional(),
  config: Json.nullish(),
  input: z.array(z.looseObject({ text: z.string().optional() })).optional(),
});
type Params = z.infer<typeof Params>;

const ZERO: Totals = { inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 };
const STEP: Totals = { inputTokens: 100, cachedInputTokens: 60, cacheWriteInputTokens: 0, outputTokens: 10, reasoningOutputTokens: 4 };

interface Loaded {
  readonly ephemeral: boolean;
  readonly modelProvider: string;
  readonly sandbox: string;
  readonly approvalPolicy: unknown;
  readonly config: Readonly<Record<string, unknown>>;
  total: Totals;
  lastTurn: string | null;
}
const loaded = new Map<string, Loaded>();
const stalled = new Map<string, () => void>();
const asked = new Map<string, (reply: unknown) => void>();
let turns = 0;

function readJson(name: string): unknown {
  return existsSync(file(name)) ? JSON.parse(readFileSync(file(name), 'utf8')) : undefined;
}
function state(): z.infer<typeof State> {
  return State.parse(readJson('state.json'));
}
function saved(): z.infer<typeof Saved> {
  return Saved.parse(readJson('threads.json') ?? {});
}
function save(threadId: string, entry: Loaded): void {
  if (entry.ephemeral) return;
  writeFileSync(file('threads.json'), JSON.stringify({ ...saved(), [threadId]: { total: entry.total, lastTurn: entry.lastTurn } }));
}
function send(message: Readonly<Record<string, unknown>>): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
}
function notify(method: string, params: Readonly<Record<string, unknown>>): void {
  send({ method, params });
}
function log(entry: Readonly<Record<string, unknown>>): void {
  appendFileSync(file('log.jsonl'), `${JSON.stringify({ daemon: process.pid, ...entry })}\n`);
}

function readAccount(): unknown {
  const pending = Switch.safeParse(readJson('switch.json'));
  if (pending.success) {
    if (pending.data.afterReads <= 0) {
      writeFileSync(file('state.json'), JSON.stringify({ ...Json.parse(readJson('state.json')), ...pending.data.state }));
      rmSync(file('switch.json'));
    } else {
      writeFileSync(file('switch.json'), JSON.stringify({ ...pending.data, afterReads: pending.data.afterReads - 1 }));
    }
  }
  const current = state();
  if (current.accountError !== null) throw new Error(current.accountError);
  return current.account;
}

function opened(threadId: string, entry: Loaded): Readonly<Record<string, unknown>> {
  return {
    thread: { id: threadId, ephemeral: entry.ephemeral },
    model: 'gpt-test',
    modelProvider: entry.modelProvider,
    approvalPolicy: entry.approvalPolicy,
    sandbox:
      entry.sandbox === 'danger-full-access'
        ? { type: 'dangerFullAccess' }
        : { type: entry.sandbox === 'read-only' ? 'readOnly' : 'workspaceWrite', networkAccess: false },
    activePermissionProfile: null,
    instructionSources: [path.join(home, '.codex', 'AGENTS.md')],
  };
}

function load(threadId: string, params: Params, ephemeral: boolean, from: { total: Totals; lastTurn: string | null }): Loaded {
  const current = state();
  const configured = z.string().nullish().parse(current.config.model_provider) ?? 'openai';
  const entry: Loaded = {
    ephemeral,
    modelProvider: current.openedProvider ?? params.modelProvider ?? configured,
    sandbox: params.sandbox ?? 'workspace-write',
    approvalPolicy: params.approvalPolicy ?? 'on-request',
    config: params.config ?? {},
    ...from,
  };
  loaded.set(threadId, entry);
  return entry;
}

function tokenUpdate(threadId: string, turnId: string, entry: Loaded): void {
  entry.total = { inputTokens: entry.total.inputTokens + STEP.inputTokens, cachedInputTokens: entry.total.cachedInputTokens + STEP.cachedInputTokens, cacheWriteInputTokens: 0, outputTokens: entry.total.outputTokens + STEP.outputTokens, reasoningOutputTokens: entry.total.reasoningOutputTokens + STEP.reasoningOutputTokens };
  notify('thread/tokenUsage/updated', { threadId, turnId, tokenUsage: { total: entry.total, last: STEP, modelContextWindow: null } });
}

function complete(threadId: string, turnId: string, entry: Loaded, status: string, error: unknown = null): void {
  entry.lastTurn = turnId;
  save(threadId, entry);
  notify('turn/completed', { threadId, turn: { id: turnId, items: [], status, error } });
}

function runTurn(threadId: string, turnId: string, entry: Loaded, prompt: string): void {
  notify('turn/started', { threadId, turn: { id: turnId, items: [], status: 'inProgress', error: null } });
  notify('item/started', { threadId, turnId, item: { type: 'userMessage', id: `${turnId}-u` }, startedAtMs: 0 });
  if (prompt.includes('ignore-interrupt')) return;
  if (prompt.includes('stall')) {
    stalled.set(turnId, () => {
      complete(threadId, turnId, entry, 'interrupted');
    });
    return;
  }
  if (prompt.includes('fail-limit')) {
    complete(threadId, turnId, entry, 'failed', { message: "You've hit your usage limit.", codexErrorInfo: 'usageLimitExceeded' });
    return;
  }
  if (prompt.includes('hint')) notify('account/rateLimits/updated', { rateLimits: { limitId: 'codex', primary: { usedPercent: 50, windowDurationMins: 300, resetsAt: 1795000000 } } });
  notify('item/started', { threadId, turnId, item: { type: 'reasoning', id: `${turnId}-r` }, startedAtMs: 0 });
  if (prompt.includes('tool')) {
    const item = { type: 'commandExecution', id: `${turnId}-c`, command: `cat ${home}/notes.txt API_TOKEN=abc123`, status: 'inProgress' };
    notify('item/started', { threadId, turnId, item, startedAtMs: 0 });
    tokenUpdate(threadId, turnId, entry);
    notify('item/completed', { threadId, turnId, item: { ...item, status: 'completed' }, completedAtMs: 0 });
  }
  const reply = () => {
    const text = `Echo: ${lastUserMessage(prompt)}`;
    notify('item/started', { threadId, turnId, item: { type: 'agentMessage', id: `${turnId}-m`, text: '' }, startedAtMs: 0 });
    notify('item/agentMessage/delta', { threadId, turnId, itemId: `${turnId}-m`, delta: text.slice(0, 6) });
    notify('item/agentMessage/delta', { threadId, turnId, itemId: `${turnId}-m`, delta: text.slice(6) });
    notify('item/completed', { threadId, turnId, item: { type: 'agentMessage', id: `${turnId}-m`, text }, completedAtMs: 0 });
    tokenUpdate(threadId, turnId, entry);
    complete(threadId, turnId, entry, 'completed');
    if (prompt.includes('close-thread')) {
      loaded.delete(threadId);
      notify('thread/closed', { threadId });
    }
  };
  if (!prompt.includes('ask')) {
    reply();
    return;
  }
  const key = `ask-${turnId}`;
  asked.set(key, (answer) => {
    log({ method: 'approval-reply', params: answer });
    reply();
  });
  send({ id: key, method: 'item/commandExecution/requestApproval', params: { threadId, turnId, itemId: `${turnId}-c`, command: 'rm -rf /', startedAtMs: 0 } });
}

/** The prompt itself, or the last `<user>` block of a seeded prompt. */
function lastUserMessage(prompt: string): string {
  const start = prompt.lastIndexOf('<user>\n');
  if (start === -1) return prompt;
  const rest = prompt.slice(start + '<user>\n'.length);
  return rest.slice(0, rest.indexOf('\n</user>'));
}

function serverStatus(threadId: string | undefined): unknown {
  const servers = Object.keys(Json.parse(state().config.mcp_servers ?? {}));
  const config = (threadId === undefined ? undefined : loaded.get(threadId))?.config ?? {};
  return { data: servers.map((name) => ({ name, runtimeStatus: config[`mcp_servers.${name}.enabled`] === false ? 'disabled' : 'connected' })), nextCursor: null };
}

function answer(method: string, raw: unknown): unknown {
  const params = Params.parse(raw ?? {});
  const threadId = params.threadId ?? '';
  switch (method) {
    case 'initialize':
      return { userAgent: 'orikami/0.171.0-alpha.13 (fake)', codexHome: path.join(home, '.codex'), platformFamily: 'unix', platformOs: 'macos' };
    case 'account/read':
      return readAccount();
    case 'config/read':
      return { config: state().config, origins: {}, layers: null };
    case 'configRequirements/read':
      return { requirements: state().requirements };
    case 'account/rateLimits/read':
      return state().rateLimits;
    case 'model/list':
      return {
        data: [
          { model: 'gpt-test', displayName: 'GPT Test', hidden: false, isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }], defaultReasoningEffort: 'low' },
          { model: 'gpt-hidden', displayName: 'Hidden', hidden: true, isDefault: false, supportedReasoningEfforts: [], defaultReasoningEffort: null },
        ],
        nextCursor: null,
      };
    case 'thread/start': {
      const ephemeral = params.ephemeral === true;
      const id = `thread-${String(Object.keys(saved()).length + 1)}${ephemeral ? `-e${String(process.pid)}-${String(loaded.size)}` : ''}`;
      const entry = load(id, params, ephemeral, { total: ZERO, lastTurn: null });
      save(id, entry);
      return opened(id, entry);
    }
    case 'thread/resume': {
      const running = loaded.get(threadId);
      if (running !== undefined) return opened(threadId, running);
      const kept = saved()[threadId];
      if (kept === undefined) throw new Error(`thread ${threadId} not found`);
      const entry = load(threadId, params, false, kept);
      if (kept.lastTurn !== null) notify('thread/tokenUsage/updated', { threadId, turnId: kept.lastTurn, tokenUsage: { total: kept.total, last: STEP, modelContextWindow: null } });
      return opened(threadId, entry);
    }
    case 'thread/unsubscribe':
      if (!state().keepLoaded) loaded.delete(threadId);
      return { status: 'unsubscribed' };
    case 'thread/loaded/list':
      return { data: [...loaded.keys()], nextCursor: null };
    case 'mcpServerStatus/list':
      return serverStatus(params.threadId);
    case 'hooks/list':
      return { data: [{ cwd: '/', hooks: state().hooks, warnings: [], errors: [] }] };
    case 'turn/start': {
      const entry = loaded.get(threadId);
      if (entry === undefined) throw new Error(`thread ${threadId} is not loaded`);
      const turnId = `turn-${String(process.pid)}-${String(++turns)}`;
      const prompt = (params.input ?? []).map((part) => part.text ?? '').join('\n');
      if (prompt.includes('garbled')) {
        if (prompt.includes('silent')) return { turn: null };
        notify('turn/started', { threadId, turn: { id: turnId, items: [], status: 'inProgress', error: null } });
      }
      setImmediate(() => {
        runTurn(threadId, turnId, entry, prompt);
      });
      return prompt.includes('garbled') ? { turn: null } : { turn: { id: turnId, items: [], status: 'inProgress', error: null } };
    }
    case 'turn/interrupt': {
      const stop = stalled.get(params.turnId ?? '');
      stalled.delete(params.turnId ?? '');
      stop?.();
      return {};
    }
    default:
      throw new Error(`fake codex does not know ${method}`);
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const message = Message.parse(JSON.parse(line));
  if (message.method === undefined) {
    asked.get(String(message.id))?.(message.result);
    asked.delete(String(message.id));
    return;
  }
  log({ method: message.method, params: message.params ?? null });
  if (message.id === undefined) return;
  try {
    send({ id: message.id, result: answer(message.method, message.params) });
  } catch (error) {
    send({ id: message.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } });
  }
});
