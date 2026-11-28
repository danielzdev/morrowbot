#!/usr/bin/env node
/**
 * A stand-in for `opencode` 2.4.1 that speaks `opencode acp` (the Agent Client Protocol) over stdio,
 * shaped like the recorded real transcripts in `packages/providers/src/opencode/fixtures/2.4.1/`.
 * It keeps its state in `$MORROWBOT_FAKE_HOME/fake-opencode/` (`$HOME` when unset): `state.json` (read on every request) can start
 * sessions in another mode (`startMode`) or report another ACP version (`protocolVersion`); every
 * request is appended to `log.jsonl`, and every launch's arguments, `HOME` and opencode variables to
 * `launches.jsonl`. The prompt picks a turn's behavior: `think` thinks first; `read-outside` asks to
 * read `$HOME/outside.txt`; `write` asks to edit a file; a denial ends the prompt as `cancelled`, as
 * opencode does. `sneaky` reports an edit it never asked for, and `switch-mode` leaves the build mode,
 * both then ignoring `session/cancel`; `fs-write` asks the client to write a file; `stall` waits for
 * `session/cancel`; `ignore-cancel` never ends; `quota` fails as opencode 2.4.1 does once the free
 * models' usage limit is reached; `spawn` starts a long-lived child process first (to prove it is
 * cleaned up); anything else replies with "Echo: <the last user message>" in two chunks.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';

const home = process.env.MORROWBOT_FAKE_HOME ?? process.env.HOME ?? '/nonexistent';
const dir = path.join(home, 'fake-opencode');
mkdirSync(dir, { recursive: true });
const file = (name: string): string => path.join(dir, name);

if (process.argv[2] === '--version') {
  process.stdout.write('opencode v2.4.1\n');
  process.exit(0);
}
const variables = Object.fromEntries(Object.entries(process.env).filter(([name]) => name === 'HOME' || name.startsWith('OPENCODE_') || /^XDG_[A-Z]+_HOME$/.test(name)));
appendFileSync(file('launches.jsonl'), `${JSON.stringify({ pid: process.pid, args: process.argv.slice(2), env: variables })}\n`);

const State = z.object({ startMode: z.string().default('build'), protocolVersion: z.number().default(1) });
const Message = z.looseObject({ id: z.union([z.number(), z.string()]).optional(), method: z.string().optional(), params: z.unknown().optional(), result: z.unknown().optional(), error: z.unknown().optional() });
const Params = z.looseObject({
  sessionId: z.string().optional(),
  cwd: z.string().optional(),
  configId: z.string().optional(),
  value: z.string().optional(),
  prompt: z.array(z.looseObject({ text: z.string().optional() })).optional(),
});
type Params = z.infer<typeof Params>;
const Chosen = z.looseObject({ outcome: z.looseObject({ outcome: z.string(), optionId: z.string().optional() }) });

const MODELS = [
  { value: 'opencode/big-pickle', name: 'opencode/Big Pickle' },
  { value: 'opencode/fake-free', name: 'opencode/Fake Free' },
];

interface Session {
  readonly cwd: string;
  model: string;
  mode: string;
  cancel: (() => void) | null;
}
const sessions = new Map<string, Session>();
const waiting = new Map<string, (reply: unknown) => void>();
let opened = 0;
let asked = 0;

function state(): z.infer<typeof State> {
  return State.parse(existsSync(file('state.json')) ? JSON.parse(readFileSync(file('state.json'), 'utf8')) : {});
}
function send(message: Readonly<Record<string, unknown>>): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
}
function update(sessionId: string, body: Readonly<Record<string, unknown>>): void {
  send({ method: 'session/update', params: { sessionId, update: body } });
}
function log(entry: Readonly<Record<string, unknown>>): void {
  appendFileSync(file('log.jsonl'), `${JSON.stringify({ daemon: process.pid, ...entry })}\n`);
}
function ask(method: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const id = String(asked++);
  const { promise, resolve } = Promise.withResolvers<unknown>();
  waiting.set(id, resolve);
  send({ id: Number(id), method, params });
  return promise;
}

function configOptions(session: Session): unknown[] {
  return [
    { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: session.model, options: MODELS },
    { id: 'mode', name: 'Session Mode', category: 'mode', type: 'select', currentValue: session.mode, options: [{ value: 'build', name: 'Build' }] },
  ];
}

function sessionOf(params: Params): [string, Session] {
  const id = params.sessionId ?? '';
  const session = sessions.get(id);
  if (session === undefined) throw new Error(`Session not found: ${id}`);
  return [id, session];
}

function cancelled(session: Session): Promise<void> {
  return new Promise((resolve) => {
    session.cancel = () => {
      session.cancel = null;
      resolve();
    };
  });
}

/** The prompt itself, or the last `<user>` block of a seeded prompt, without MorrowBot's instructions. */
function lastUserMessage(prompt: string): string {
  const body = prompt.startsWith('<instructions>\n') ? prompt.slice(prompt.indexOf('\n</instructions>\n\n') + '\n</instructions>\n\n'.length) : prompt;
  const start = body.lastIndexOf('<user>\n');
  if (start === -1) return body;
  const rest = body.slice(start + '<user>\n'.length);
  return rest.slice(0, rest.indexOf('\n</user>'));
}

const USAGE = { inputTokens: 1150, outputTokens: 3, totalTokens: 1665, cachedReadTokens: 512 };

/** One tool call that asks first; `onAllowed` does its work. A denial ends the prompt as `cancelled`, as opencode 2.4.1 does. */
async function permitted(sessionId: string, call: { readonly id: string; readonly kind: string; readonly name: string; readonly path: string }, onAllowed: () => string): Promise<unknown> {
  const toolCall = { toolCallId: call.id, name: call.name, kind: call.kind, locations: [{ path: call.path }], rawInput: { path: call.path } };
  update(sessionId, { sessionUpdate: 'tool_call', ...toolCall, title: call.name, status: 'pending', locations: [], rawInput: {} });
  update(sessionId, { sessionUpdate: 'tool_call_update', ...toolCall, title: call.name, status: 'in_progress' });
  const reply = Chosen.safeParse(
    await ask('session/request_permission', {
      sessionId,
      toolCall: { ...toolCall, title: call.path, status: 'pending' },
      options: [
        { optionId: 'once', kind: 'allow_once', name: 'Allow once' },
        { optionId: 'always', kind: 'allow_always', name: 'Always allow' },
        { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
      ],
    }),
  );
  const choice = reply.success ? (reply.data.outcome.optionId ?? reply.data.outcome.outcome) : 'malformed';
  log({ method: 'permission-reply', params: { tool: call.kind, choice } });
  if (choice !== 'once' && choice !== 'always') {
    update(sessionId, { sessionUpdate: 'tool_call_update', ...toolCall, title: call.name, status: 'failed', rawOutput: { error: 'The user declined this tool call' } });
    return { stopReason: 'cancelled', usage: USAGE, _meta: {} };
  }
  const text = onAllowed();
  update(sessionId, { sessionUpdate: 'tool_call_update', ...toolCall, title: call.name, status: 'completed' });
  update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
  return { stopReason: 'end_turn', usage: USAGE, _meta: {} };
}

async function prompt(sessionId: string, session: Session, sent: string): Promise<unknown> {
  const text = lastUserMessage(sent);
  if (text.includes('quota')) throw new Error('Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.');
  if (text.includes('think')) update(sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Hmm.' } });
  if (text.includes('spawn')) {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    log({ method: 'spawned', params: { pid: child.pid ?? null } });
  }
  if (text.includes('fs-write')) {
    const reply = await ask('fs/write_text_file', { sessionId, path: path.join(session.cwd, 'client.txt'), content: 'x' });
    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `fs write: ${JSON.stringify(reply)}` } });
    return { stopReason: 'end_turn', usage: USAGE, _meta: {} };
  }
  if (text.includes('read-outside')) {
    const outside = path.join(home, 'outside.txt');
    return permitted(sessionId, { id: 'call-read', kind: 'read', name: 'read', path: outside }, () => `outside says: ${readFileSync(outside, 'utf8')}`);
  }
  if (text.includes('write')) {
    return permitted(sessionId, { id: 'call-write', kind: 'edit', name: 'write', path: path.join(session.cwd, 'inside.txt') }, () => 'wrote inside.txt');
  }
  if (text.includes('sneaky') || text.includes('switch-mode')) {
    if (text.includes('sneaky')) update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'call-sneaky', title: 'write', kind: 'edit', status: 'completed', locations: [{ path: path.join(session.cwd, 'sneaky.txt') }] });
    else {
      session.mode = 'plan';
      update(sessionId, { sessionUpdate: 'config_option_update', configOptions: configOptions(session) });
    }
    return new Promise(() => undefined);
  }
  if (text.includes('ignore-cancel')) return new Promise(() => undefined);
  if (text.includes('stall')) {
    await cancelled(session);
    return { stopReason: 'cancelled', _meta: {} };
  }
  const reply = `Echo: ${text}`;
  update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: reply.slice(0, 6) } });
  update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: reply.slice(6) } });
  update(sessionId, { sessionUpdate: 'usage_update', used: 1665, size: 200000, cost: { amount: 0, currency: 'USD' } });
  return { stopReason: 'end_turn', usage: USAGE, _meta: {} };
}

async function answer(method: string, raw: unknown): Promise<unknown> {
  const params = Params.parse(raw ?? {});
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: state().protocolVersion,
        agentCapabilities: { loadSession: true, mcpCapabilities: { http: true, sse: false }, sessionCapabilities: { close: {}, list: {}, resume: {} }, _meta: { 'opencode/child-session-updates': true } },
        authMethods: [{ description: 'Run `opencode auth login` in the terminal', name: 'Login with opencode', id: 'opencode-login' }],
        agentInfo: { name: 'OpenCode', version: '2.4.1' },
      };
    case 'session/new': {
      const id = `ses_${String(process.pid)}_${String(++opened)}`;
      const session: Session = { cwd: params.cwd ?? home, model: 'opencode/big-pickle', mode: state().startMode, cancel: null };
      sessions.set(id, session);
      setImmediate(() => {
        update(id, { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'init', description: 'guided AGENTS.md setup' }] });
      });
      return { sessionId: id, configOptions: configOptions(session) };
    }
    case 'session/set_config_option': {
      const [, session] = sessionOf(params);
      const value = params.value ?? '';
      if (params.configId === 'model') {
        if (!MODELS.some((model) => model.value === value)) throw new Error(`Model not found: ${value}`);
        session.model = value;
      }
      return { configOptions: configOptions(session) };
    }
    case 'session/prompt': {
      const [id, session] = sessionOf(params);
      return prompt(id, session, (params.prompt ?? []).map((part) => part.text ?? '').join('\n'));
    }
    case 'session/close':
      sessions.delete(params.sessionId ?? '');
      return {};
    default:
      throw new Error(`fake opencode does not know ${method}`);
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const message = Message.parse(JSON.parse(line));
  if (message.method === undefined) {
    log({ method: 'client-reply', params: { id: message.id, result: message.result ?? null, error: message.error ?? null } });
    waiting.get(String(message.id))?.(message.error === undefined ? message.result : { error: message.error });
    waiting.delete(String(message.id));
    return;
  }
  log({ method: message.method, params: message.params ?? null });
  if (message.method === 'session/cancel') {
    sessions.get(Params.parse(message.params ?? {}).sessionId ?? '')?.cancel?.();
    return;
  }
  if (message.id === undefined) return;
  const id = message.id;
  answer(message.method, message.params).then(
    (result) => {
      send({ id, result });
    },
    (error: unknown) => {
      send({ id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } });
    },
  );
});
