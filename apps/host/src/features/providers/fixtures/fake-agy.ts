#!/usr/bin/env node
/**
 * A stand-in for `agy` 1.5.18 that speaks `agy acp` (the Agent Client Protocol) over stdio, shaped
 * like the recorded real transcripts in `packages/providers/src/antigravity/fixtures/1.5.18/`. It
 * keeps its state in `$HOME/fake-agy/`: `state.json` (read on every request) can sign it out
 * (`signedOut`, answered on `session/new` as agy 1.5.18 does), start sessions in another mode
 * (`startMode`), refuse mode changes (`lockMode`), leave Default mode right after a model change
 * (`driftOnModel`) or report another ACP version (`protocolVersion`); every request is appended to
 * `log.jsonl`, and every launch's arguments to `launches.jsonl`. The prompt picks a turn's behavior:
 * `think` thinks first; `write`, `command` and `read-outside` ask for permission (an allowed write or
 * command really writes `inside.txt` or `ran.txt` in the session's folder); `sneaky` reports an edit
 * it never asked for, and `switch-mode` leaves Default mode, both then ignoring `session/cancel`;
 * `fs-write` asks the client to write a file; `stall` waits for `session/cancel`; `ignore-cancel`
 * never ends; `quota` fails on the plan's quota; anything else replies with "Echo: <the last user message>".
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';

const home = process.env.HOME ?? '/nonexistent';
const dir = path.join(home, 'fake-agy');
mkdirSync(dir, { recursive: true });
const file = (name: string): string => path.join(dir, name);

if (process.argv[2] === '--version') {
  process.stdout.write('1.5.18\n');
  process.exit(0);
}
appendFileSync(file('launches.jsonl'), `${JSON.stringify({ pid: process.pid, args: process.argv.slice(2) })}\n`);

const State = z.object({
  signedOut: z.boolean().default(false),
  startMode: z.string().default('default'),
  lockMode: z.boolean().default(false),
  driftOnModel: z.boolean().default(false),
  protocolVersion: z.number().default(1),
});
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

const THINKING: Readonly<Record<string, { readonly levels: readonly string[]; readonly start: string }>> = {
  'fake-pro': { levels: ['low', 'high'], start: 'high' },
  'fake-flash': { levels: ['minimal', 'low'], start: 'low' },
};

interface Session {
  readonly cwd: string;
  model: string;
  thought: string;
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
  const id = `agy-${String(++asked)}`;
  const { promise, resolve } = Promise.withResolvers<unknown>();
  waiting.set(id, resolve);
  send({ id, method, params });
  return promise;
}

function configOptions(session: Session): unknown[] {
  const thinking = THINKING[session.model] ?? { levels: [], start: '' };
  return [
    { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: session.model, options: [{ value: 'fake-pro', name: 'Fake Pro' }, { value: 'fake-flash', name: 'Fake Flash' }] },
    { id: 'thought_level', name: 'Thinking Level', category: 'thought_level', type: 'select', currentValue: session.thought, options: thinking.levels.map((level) => ({ value: level, name: level.toUpperCase() })) },
    {
      id: 'mode',
      name: 'Mode',
      category: 'mode',
      type: 'select',
      currentValue: session.mode,
      options: ['default', 'accept-edits', 'auto', 'plan'].map((mode) => ({ value: mode, name: mode })),
    },
  ];
}

function sessionOf(params: Params): [string, Session] {
  const id = params.sessionId ?? '';
  const session = sessions.get(id);
  if (session === undefined) throw new Error(`session ${id} not found`);
  return [id, session];
}

/** Waits for `session/cancel` on this session, up to `ms`; true when it came. */
function cancelled(session: Session, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      session.cancel = null;
      resolve(false);
    }, ms);
    session.cancel = () => {
      clearTimeout(timer);
      session.cancel = null;
      resolve(true);
    };
  });
}

/** The prompt itself, or the last `<user>` block of a seeded prompt. */
function lastUserMessage(prompt: string): string {
  const start = prompt.lastIndexOf('<user>\n');
  if (start === -1) return prompt;
  const rest = prompt.slice(start + '<user>\n'.length);
  return rest.slice(0, rest.indexOf('\n</user>'));
}

const USAGE = { inputTokens: 120, outputTokens: 12, cachedReadTokens: 80, cachedWriteTokens: 0, thoughtTokens: 3, totalTokens: 212 };

/** One tool call that asks first; `onAllowed` does its work. Ends the turn on a denial, as agy does. */
async function permitted(sessionId: string, call: { readonly id: string; readonly kind: string; readonly title: string; readonly path: string | null }, onAllowed: () => string): Promise<unknown> {
  const toolCall = { toolCallId: call.id, title: call.title, kind: call.kind, locations: call.path === null ? [] : [{ path: call.path }], rawInput: {} };
  update(sessionId, { sessionUpdate: 'tool_call', ...toolCall, status: 'in_progress' });
  update(sessionId, { sessionUpdate: 'tool_call_update', ...toolCall, status: 'pending' });
  const reply = Chosen.safeParse(
    await ask('session/request_permission', {
      sessionId,
      toolCall: { sessionUpdate: 'tool_call', ...toolCall, status: 'pending' },
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
      ],
    }),
  );
  const choice = reply.success ? (reply.data.outcome.optionId ?? reply.data.outcome.outcome) : 'malformed';
  log({ method: 'permission-reply', params: { tool: call.kind, choice } });
  if (choice !== 'allow' && choice !== 'always') {
    update(sessionId, { sessionUpdate: 'tool_call_update', ...toolCall, status: 'failed', rawOutput: 'user denied permission' });
    return { stopReason: choice === 'cancelled' ? 'cancelled' : 'end_turn', usage: USAGE };
  }
  const text = onAllowed();
  update(sessionId, { sessionUpdate: 'tool_call_update', ...toolCall, status: 'completed' });
  update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
  return { stopReason: 'end_turn', usage: USAGE };
}

async function prompt(sessionId: string, session: Session, sent: string): Promise<unknown> {
  const text = lastUserMessage(sent);
  if (text.includes('quota')) throw new Error('RESOURCE_EXHAUSTED: You have exhausted your quota for this model.');
  if (text.includes('think')) update(sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Hmm.' } });
  if (text.includes('fs-write')) {
    const reply = await ask('fs/write_text_file', { sessionId, path: path.join(session.cwd, 'client.txt'), content: 'x' });
    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `fs write: ${JSON.stringify(reply)}` } });
    return { stopReason: 'end_turn', usage: USAGE };
  }
  if (text.includes('write')) {
    return permitted(sessionId, { id: 'call-write', kind: 'edit', title: 'File inside.txt', path: path.join(session.cwd, 'inside.txt') }, () => {
      writeFileSync(path.join(session.cwd, 'inside.txt'), 'x');
      return 'wrote inside.txt';
    });
  }
  if (text.includes('command')) {
    return permitted(sessionId, { id: 'call-command', kind: 'execute', title: 'touch ran.txt', path: null }, () => {
      writeFileSync(path.join(session.cwd, 'ran.txt'), '');
      return 'ran it';
    });
  }
  if (text.includes('read-outside')) {
    const outside = path.join(home, 'outside.txt');
    return permitted(sessionId, { id: 'call-read', kind: 'read', title: 'File outside.txt', path: outside }, () => `outside says: ${readFileSync(outside, 'utf8')}`);
  }
  if (text.includes('sneaky') || text.includes('switch-mode')) {
    if (text.includes('sneaky')) update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'call-sneaky', title: 'File sneaky.txt', kind: 'edit', status: 'completed' });
    else {
      session.mode = 'auto';
      update(sessionId, { sessionUpdate: 'config_option_update', configOptions: configOptions(session) });
    }
    return new Promise(() => undefined);
  }
  if (text.includes('ignore-cancel')) return new Promise(() => undefined);
  if (text.includes('stall')) {
    await cancelled(session, 60_000);
    return { stopReason: 'cancelled', usage: USAGE };
  }
  const reply = `Echo: ${text}`;
  update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: reply.slice(0, 6) } });
  update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: reply.slice(6) } });
  update(sessionId, { sessionUpdate: 'usage_update', used: 212, size: 1048576 });
  return { stopReason: 'end_turn', usage: USAGE };
}

async function answer(method: string, raw: unknown): Promise<unknown> {
  const params = Params.parse(raw ?? {});
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: state().protocolVersion,
        agentCapabilities: { loadSession: true, sessionCapabilities: { close: {}, load: {} }, _meta: { antigravity: { tier: true, systemPrompt: { append: true } } } },
        agentInfo: { name: 'Antigravity ACP Server', version: '1.5.18' },
        authMethods: [{ id: 'oauth-personal', name: 'Log in with Google' }],
      };
    case 'session/new': {
      if (state().signedOut) throw Object.assign(new Error('Authentication required'), { code: -32000 });
      const id = `sess-${String(process.pid)}-${String(++opened)}`;
      const session: Session = { cwd: params.cwd ?? home, model: 'fake-pro', thought: 'high', mode: state().startMode, cancel: null };
      sessions.set(id, session);
      setImmediate(() => {
        update(id, { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'goal', description: 'Run until done.' }] });
      });
      return { sessionId: id, configOptions: configOptions(session), _meta: { antigravity: { tier: { name: 'Google AI Pro', id: 'g1-pro-tier' } } } };
    }
    case 'session/load': {
      const id = params.sessionId ?? '';
      const session: Session = { cwd: params.cwd ?? home, model: 'fake-pro', thought: 'high', mode: state().startMode, cancel: null };
      sessions.set(id, session);
      update(id, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'an earlier question' } });
      update(id, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'an earlier answer' } });
      update(id, { sessionUpdate: 'tool_call', toolCallId: 'old-call', title: 'File old.txt', kind: 'edit', status: 'completed' });
      return { configOptions: configOptions(session) };
    }
    case 'session/set_config_option': {
      const [id, session] = sessionOf(params);
      const value = params.value ?? '';
      if (params.configId === 'model') {
        const thinking = THINKING[value];
        if (thinking === undefined) throw new Error(`model ${value} not found`);
        session.model = value;
        session.thought = thinking.start;
        if (state().driftOnModel) {
          const answer = configOptions(session);
          session.mode = 'auto';
          setImmediate(() => {
            update(id, { sessionUpdate: 'config_option_update', configOptions: configOptions(session) });
          });
          return { configOptions: answer };
        }
      } else if (params.configId === 'thought_level') session.thought = value;
      else if (params.configId === 'mode' && !state().lockMode) session.mode = value;
      setImmediate(() => {
        update(id, { sessionUpdate: 'config_option_update', configOptions: configOptions(session) });
      });
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
      throw new Error(`fake agy does not know ${method}`);
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
      const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'number' ? error.code : -32603;
      send({ id, error: { code, message: error instanceof Error ? error.message : String(error) } });
    },
  );
});
