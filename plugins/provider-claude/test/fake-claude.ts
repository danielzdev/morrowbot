#!/usr/bin/env node
/**
 * A stand-in for the `claude` CLI that prints recorded-shape stream-json lines.
 * The last line of the prompt picks the behavior: hello, env, stall, fail, crash.
 */
const args = process.argv.slice(2);

function line(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function streamEvent(event: unknown, parent: string | null = null): void {
  line({ type: 'stream_event', event, parent_tool_use_id: parent, session_id: 'fake' });
}

function delta(text: string): void {
  streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
}

function finish(text: string): void {
  line({ type: 'result', subtype: 'success', is_error: false, result: text, stop_reason: 'end_turn', session_id: 'fake' });
}

function reply(prompt: string): void {
  const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'claude-default';
  line({ type: 'system', subtype: 'init', model, tools: ['Read'] });
  line({ type: 'system', subtype: 'status', status: 'requesting' });
  const command = prompt.trim().split('\n').at(-1) ?? '';
  switch (command) {
    case 'hello':
      streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });
      line({
        type: 'assistant',
        parent_tool_use_id: null,
        message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: './note.txt' } }] },
      });
      streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'subagent text' } }, 'toolu_1');
      line({
        type: 'user',
        parent_tool_use_id: null,
        message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true, content: 'missing' }] },
      });
      line({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } });
      process.stdout.write('this is not json\n');
      delta('Hel');
      delta('lo');
      streamEvent({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null } });
      finish('Hello');
      return;
    case 'env':
      delta(`cwd=${process.cwd()} env=${Object.keys(process.env).sort().join(',')} args=${args.join(' ')}`);
      finish('env');
      return;
    case 'stall':
      process.on('SIGTERM', () => undefined);
      delta(`pid ${String(process.pid)}`);
      setInterval(() => undefined, 1_000);
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
      throw new Error(`fake claude: unknown command "${command}"`);
  }
}

if (args[0] === 'auth') {
  line({ loggedIn: process.env.CLAUDE_CONFIG_DIR !== '/signed-out', authMethod: 'claude.ai' });
} else {
  let prompt = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (text: string) => (prompt += text));
  process.stdin.on('end', () => {
    reply(prompt);
  });
}
