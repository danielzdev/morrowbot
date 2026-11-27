#!/usr/bin/env node
/**
 * A stand-in for the `claude` CLI (2.1.332) that prints stream-json lines shaped like the real ones.
 * It reads `--input-format stream-json` frames: exactly one user frame per run, whose last user
 * message picks the behavior, then control responses, until stdin closes. It keeps its state in
 * `$HOME/fake-claude/`: every invocation is appended to `log.jsonl`; `auth.json`, when present, is
 * what `auth status` prints; `hang-version`, when present, makes `--version` hang and ignore SIGTERM;
 * `hold-auth`, when present, is renamed to `auth-held` by the next `auth status`, which reads its
 * answer and then waits to print it until `auth-held` is removed; `policy-after-auths` holds a count N
 * of `auth status` runs to let pass, and the next one writes a server-managed policy cache first.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';

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

function deployPolicyWhenDue(): void {
  const due = path.join(state, 'policy-after-auths');
  if (!existsSync(due)) return;
  const left = Number(readFileSync(due, 'utf8'));
  if (left > 0) {
    writeFileSync(due, String(left - 1));
    return;
  }
  rmSync(due);
  const configDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(process.env.HOME ?? '/nonexistent', '.claude');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, 'remote-settings.json'), JSON.stringify({ hooks: { PreToolUse: [] } }));
}

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

/** Control responses from stdin, by request id. */
const responses = new Map<string, PromiseWithResolvers<unknown>>();

function controlResponse(requestId: string): Promise<unknown> {
  const waiting = responses.get(requestId) ?? Promise.withResolvers<unknown>();
  responses.set(requestId, waiting);
  return waiting.promise;
}

/** Writes `.git/x` after asking the host, as Claude Code does for a protected path with `--permission-prompt-tool stdio`. */
async function writeGit(): Promise<void> {
  const input = { file_path: path.join(process.cwd(), '.git', 'x'), content: 'hi' };
  line({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'toolu_w', name: 'Write', input }] } });
  let decision: unknown = { behavior: 'deny', message: 'no approval surface' };
  if (flag('--permission-prompt-tool') === 'stdio') {
    const request = {
      subtype: 'can_use_tool',
      tool_name: 'Write',
      display_name: 'Write',
      input,
      description: '.git/x',
      decision_reason: `Claude requested permissions to edit ${input.file_path} which is a sensitive file.`,
      tool_use_id: 'toolu_w',
    };
    line({ type: 'control_request', request_id: 'req-1', request });
    decision = await controlResponse('req-1');
  }
  const Decision = z.object({ behavior: z.enum(['allow', 'deny']), message: z.string().optional() });
  const { behavior, message } = Decision.parse(decision);
  if (behavior === 'allow') {
    mkdirSync(path.dirname(input.file_path), { recursive: true });
    writeFileSync(input.file_path, input.content);
  }
  line({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_w', is_error: behavior !== 'allow' }] } });
  delta(behavior === 'allow' ? 'Wrote .git/x' : `Not written: ${message ?? ''}`);
  finish('done');
}

function rateLimit(status: 'allowed' | 'rejected', fiveHour: number): void {
  const resetsAt = 1_795_788_600;
  line({
    type: 'rate_limit_event',
    rate_limit_info: {
      status,
      resetsAt,
      rateLimitType: 'five_hour',
      overageStatus: 'rejected',
      isUsingOverage: false,
      unifiedWindows: {
        five_hour: { utilization: fiveHour, resetsAt, status },
        seven_day: { utilization: 0.24, resetsAt: 1_795_845_600, status: 'allowed' },
      },
    },
  });
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

async function reply(prompt: string): Promise<void> {
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
    case 'write-git':
      await writeGit();
      return;
    case 'rate-limit':
      rateLimit('allowed', 0.1);
      delta('Counted');
      finish('Counted');
      return;
    case 'limited':
      rateLimit('rejected', 1);
      line({ type: 'result', subtype: 'success', is_error: true, result: "You've hit your limit · resets 2:10pm" });
      process.exitCode = 1;
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
  deployPolicyWhenDue();
  const custom = path.join(state, 'auth.json');
  const answer = existsSync(custom) ? readFileSync(custom, 'utf8') : `${JSON.stringify(SIGNED_IN)}\n`;
  const held = path.join(state, 'auth-held');
  if (!existsSync(path.join(state, 'hold-auth'))) process.stdout.write(answer);
  else {
    renameSync(path.join(state, 'hold-auth'), held);
    const poll = setInterval(() => {
      if (existsSync(held)) return;
      clearInterval(poll);
      process.stdout.write(answer);
    }, 20);
  }
} else {
  const Frame = z.discriminatedUnion('type', [
    z.object({ type: z.literal('user'), message: z.object({ role: z.literal('user'), content: z.string() }) }),
    z.object({
      type: z.literal('control_response'),
      response: z.object({ subtype: z.literal('success'), request_id: z.string(), response: z.unknown() }),
    }),
  ]);
  let users = 0;
  for await (const text of createInterface({ input: process.stdin })) {
    const frame = Frame.parse(JSON.parse(text));
    switch (frame.type) {
      case 'user':
        users += 1;
        if (users > 1) {
          process.stderr.write('fake claude: got a second user frame\n');
          process.exit(3);
        }
        record(frame.message.content);
        void reply(frame.message.content);
        break;
      case 'control_response': {
        const waiting = responses.get(frame.response.request_id) ?? Promise.withResolvers<unknown>();
        responses.set(frame.response.request_id, waiting);
        waiting.resolve(frame.response.response);
        break;
      }
    }
  }
}
