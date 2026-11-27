#!/usr/bin/env node
/**
 * A stand-in for the `claude` CLI (2.1.332) that prints stream-json lines shaped like the real ones.
 * The last user message of the prompt picks the behavior. It keeps its state in `$HOME/fake-claude/`:
 * every invocation is appended to `log.jsonl`; `auth.json`, when present, is what `auth status`
 * prints; `hang-version`, when present, makes `--version` hang and ignore SIGTERM.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const state = path.join(process.env.HOME ?? '/nonexistent', 'fake-claude');

const SIGNED_IN = {
  loggedIn: true,
  authMethod: 'claude.ai',
  apiProvider: 'firstParty',
  subscriptionType: 'max',
  planTier: 'max_5x',
  email: 'user@example.com',
  orgId: '00000000-0000-0000-0000-000000000000',
};

function record(stdin: string | null): void {
  mkdirSync(state, { recursive: true });
  appendFileSync(path.join(state, 'log.jsonl'), `${JSON.stringify({ args, cwd: process.cwd(), stdin, pid: process.pid })}\n`);
}

function line(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function streamEvent(event: unknown, parent: string | null = null): void {
  line({ type: 'stream_event', event, parent_tool_use_id: parent, session_id: 'fake' });
}

function delta(text: string): void {
  streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
}

function toolCall(id: string, input: unknown, isError: boolean): void {
  line({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id, name: 'Read', input }] } });
  line({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError }] } });
}

const USAGE = { input_tokens: 12, cache_read_input_tokens: 3400, cache_creation_input_tokens: 56, output_tokens: 7 };

function finish(text: string): void {
  line({ type: 'result', subtype: 'success', is_error: false, result: text, stop_reason: 'end_turn', usage: USAGE, session_id: 'fake' });
}

function flag(name: string): string | undefined {
  return args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
}

function hang(): void {
  process.on('SIGTERM', () => undefined);
  setInterval(() => undefined, 1_000);
}

/** Starts a tool that ignores SIGTERM and holds stdout open, reports both pids, and hangs ignoring SIGTERM itself. */
function stall(): void {
  hang();
  const tool = spawn(
    process.execPath,
    ['-e', "process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 1000)"],
    { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] },
  );
  tool.once('message', () => {
    tool.disconnect();
    delta(`pids ${String(process.pid)} ${String(tool.pid)}`);
  });
}

/** The new message: the last `<user>` block of a seeded prompt, or the bare prompt. */
function command(prompt: string): string {
  const blocks = [...prompt.matchAll(/<user>\n([\s\S]*?)\n<\/user>/g)];
  return (blocks.at(-1)?.[1] ?? prompt).trim();
}

function reply(prompt: string): void {
  line({ type: 'system', subtype: 'init', model: flag('--model') ?? 'claude-fable-5-2', tools: ['Read', 'Glob', 'Grep'] });
  const said = command(prompt);
  switch (said) {
    case 'hello':
      streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });
      toolCall('toolu_1', { file_path: './note.txt' }, false);
      streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'subagent text' } }, 'toolu_1');
      delta('Hel');
      delta('lo');
      finish('Hello');
      return;
    case 'result-only':
      finish('Only the result');
      return;
    case 'segments':
      delta('Let me look. ');
      toolCall('toolu_2', { file_path: 'note.txt' }, false);
      delta('Found it.');
      finish('Found it.');
      return;
    case 'stall':
      stall();
      return;
    case 'fail':
      line({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' });
      process.exitCode = 1;
      return;
    case 'crash':
      process.stderr.write('fake claude: boom\n');
      process.exit(2);
      break;
    default:
      delta(`You said: ${said}`);
      finish(`You said: ${said}`);
  }
}

if (args[0] === '--version') {
  record(null);
  if (existsSync(path.join(state, 'hang-version'))) hang();
  else process.stdout.write('2.1.332 (Claude Code)\n');
} else if (args[0] === 'auth') {
  record(null);
  const custom = path.join(state, 'auth.json');
  process.stdout.write(existsSync(custom) ? readFileSync(custom, 'utf8') : `${JSON.stringify(SIGNED_IN)}\n`);
} else {
  let prompt = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (text: string) => (prompt += text));
  process.stdin.on('end', () => {
    record(prompt);
    reply(prompt);
  });
}
