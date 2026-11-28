import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { QUIET_MARKER } from '@morrowbot/contracts';
import { defineProvider, runPlugin, z, type AccessProfile, type PluginConfig, type TurnEnd, type TurnRequest } from '@morrowbot/plugin-sdk';

/**
 * A test provider. It answers with its greeting and the prompt; some prompts pick a behavior.
 * The `account` file in its data folder, when present, overrides the account it is signed in to.
 * With `sessions` on it keeps fake vendor sessions, so the host's session rules can be exercised.
 * `steerable` takes a steer mid-turn; `gate` runs until a `gate` file appears in its data folder.
 * `tools-gate` reads a file (ok), then runs a command that fails once the `gate` file appears.
 * A prompt whose first line is `nothing-new` gets only the stay-quiet marker back, as a routine's agent would send.
 * Each prompt line `host-tool <name> <json arguments>` calls that MorrowBot tool over the turn's MCP endpoint
 * and answers with the results; `{{message}}` in the arguments is the id of the agent message being read.
 * Such a prompt whose first line is `once-fail` fails the first time, like the `once-fail` prompt.
 * In the turn a user's reaction starts, each quoted line ending `on-reaction <name> <json arguments>` is such a call.
 * Every turn saves its `hostTools` as `host-tools.json` in the data folder.
 */
let config: PluginConfig = {};
let dataDir = '';

function account(): string {
  try {
    return readFileSync(path.join(dataDir, 'account'), 'utf8').trim();
  } catch {
    return String(config.accountKey);
  }
}

const keepsSessions = (): boolean => config.sessions === true;
const PROFILE: AccessProfile = { access: 'read-only', vendorSettings: 'isolated', modes: ['interactive', 'background'], readsOutsideCwd: false };

const ToolAnswer = z.looseObject({
  result: z.looseObject({ content: z.array(z.looseObject({ text: z.string() })), isError: z.boolean() }).optional(),
  error: z.looseObject({ message: z.string() }).optional(),
});

async function callHostTool(tools: TurnRequest['hostTools'], name: string, args: unknown): Promise<string> {
  if (tools.kind === 'none') return 'no host tools';
  const response = await fetch(tools.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${tools.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const answer = ToolAnswer.parse(await response.json());
  if (answer.result === undefined) return `rpc error ${answer.error?.message ?? 'unknown'}`;
  return `${answer.result.isError ? 'error ' : ''}${answer.result.content.map(({ text }) => text).join('')}`;
}

function end(outcome: TurnEnd['outcome'], accountKey: string, extra: Partial<TurnEnd> = {}): TurnEnd {
  return { outcome, usage: { kind: 'unavailable' }, actualModel: null, accountKey, sessionTouched: true, finalText: null, ...extra };
}

runPlugin((runtime) =>
  defineProvider({
    init: (context) => {
      config = context.config;
      dataDir = context.dataDir;
    },
    providerInfo: () => ({
      kind: 'ready',
      version: '1.0.0',
      accountKey: account(),
      accountLabel: null,
      models: [{ id: 'tiny', label: 'Tiny', isDefault: true, options: [] }],
      capabilities: {
        profiles: [PROFILE],
        approvals: false,
        sessions: keepsSessions(),
        usage: 'live',
        withheld: [{ access: 'workspace-write', vendorSettings: 'isolated', reason: 'Echo only reads.' }],
      },
      warning: null,
    }),
    usage: () => ({ kind: 'unavailable', observedAt: '2026-01-01T00:00:00.000Z', accountKey: account(), reason: 'not-yet-observed' }),
    routeInfo: ({ cwd }) => {
      switch (String(config.routeInfo)) {
        case 'fail':
          return { kind: 'failed', reason: 'echo route-info failed' };
        case 'hang':
          return new Promise(() => undefined);
        default: {
          const blank = String(config.blankCwd);
          return { kind: 'known', accountKey: blank !== '' && path.basename(cwd) === blank ? '' : account(), routeKey: '' };
        }
      }
    },
    turn: async ({ request, signal, emit, onSteer }) => {
      const current = account();
      if (request.expectedAccountKey !== '' && current !== request.expectedAccountKey) {
        return end({ kind: 'failed', error: { kind: 'account-changed' } }, current, { sessionTouched: false });
      }
      const { prompt } = request;
      writeFileSync(path.join(dataDir, 'host-tools.json'), JSON.stringify(request.hostTools));
      if (keepsSessions() && request.session.kind === 'new' && request.expectedAccountKey !== '') {
        emit({ kind: 'session-bound', ref: `ref-${request.turnId}`, accountKey: current, routeKey: request.expectedRouteKey });
      }
      const reaction = /^The user reacted /m.test(prompt);
      const toolCalls = (text: string, pattern: RegExp) =>
        text.split('\n').flatMap((line) => {
          const [, name, args] = pattern.exec(line.trim()) ?? [];
          return name === undefined || args === undefined ? [] : [{ name, args }];
        });
      const runTools = async (calls: readonly { name: string; args: string }[], reading: string | undefined, first: boolean) => {
        for (const [at, call] of calls.entries()) {
          const args: unknown = JSON.parse(reading === undefined ? call.args : call.args.replaceAll('{{message}}', reading));
          emit({ kind: 'text', text: `${at === 0 && first ? '' : '\n'}${call.name}: ${await callHostTool(request.hostTools, call.name, args)}` });
        }
      };
      const calls = toolCalls(prompt, reaction ? / on-reaction (\S+) (\{.*\})$/ : /^host-tool (\S+) (\{.*\})$/);
      if (calls.length > 0 && prompt.split('\n')[0] === 'once-fail' && !existsSync(path.join(dataDir, 'failed-once'))) {
        writeFileSync(path.join(dataDir, 'failed-once'), request.turnId);
        return end({ kind: 'failed', error: { kind: 'other', message: 'echo failed once' } }, current);
      }
      if (calls.length > 0) {
        await runTools(calls, /^Message (\S+) from the agent/m.exec(prompt)?.[1], true);
        return end({ kind: 'completed', finishReason: 'stop' }, current);
      }
      const background = prompt.startsWith('You are reading a message from another agent in the background:');
      const command = reaction
        ? (/ on-reaction (\S+)$/m.exec(prompt)?.[1] ?? prompt)
        : background
          ? (/^on-background (\S+)$/m.exec(prompt)?.[1] ?? prompt)
          : prompt;
      if (prompt.split('\n')[0] === 'nothing-new') return end({ kind: 'completed', finishReason: 'stop' }, current, { finalText: QUIET_MARKER });
      if (command === 'huge-final') return end({ kind: 'completed', finishReason: 'stop' }, current, { finalText: '01234567890123456789ab😀cd' });
      if (command === 'flood-bytes') {
        for (const chunk of ['0123456789', '0123456789', 'ab😀cd', 'zzzzzzzzzz', 'yyyyyyyyyy']) {
          if (signal.aborted) break;
          emit({ kind: 'text', text: chunk });
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return end(signal.aborted ? { kind: 'cancelled' } : { kind: 'completed', finishReason: 'stop' }, current);
      }
      if (command === 'flood-bytes-unstoppable') {
        for (let i = 0; i < 10; i += 1) emit({ kind: 'text', text: 'X'.repeat(10) });
        return new Promise(() => undefined);
      }
      if (command === 'flood-events') {
        emit({ kind: 'text', text: 'hello' });
        for (let i = 1; i <= 30; i += 1) {
          if (signal.aborted) break;
          emit({ kind: 'status', text: `step ${String(i)}` });
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return end(signal.aborted ? { kind: 'cancelled' } : { kind: 'completed', finishReason: 'stop' }, current);
      }
      emit({ kind: 'text', text: `${String(config.greeting)} from pid ${String(process.pid)}:` });
      if (prompt.endsWith('describe-input')) {
        const images = request.images.map(({ mimeType, data }) => ({ mimeType, bytes: Buffer.from(data, 'base64').length }));
        emit({ kind: 'text', text: ` ${JSON.stringify({ prompt, images })}` });
        return end({ kind: 'completed', finishReason: 'stop' }, current);
      }
      switch (command) {
        case 'crash':
          process.exit(3);
          break;
        case 'stall':
          return new Promise(() => undefined);
        case 'stall-polite':
          await new Promise((resolve) => {
            signal.addEventListener('abort', resolve, { once: true });
          });
          return end({ kind: 'cancelled' }, current);
        case 'fail':
          return end({ kind: 'failed', error: { kind: 'other', message: 'echo failed' } }, current);
        case 'untouched':
          return end({ kind: 'failed', error: { kind: 'other', message: 'echo sent nothing' } }, current, { sessionTouched: false });
        case 'once-fail': {
          if (!existsSync(path.join(dataDir, 'failed-once'))) {
            writeFileSync(path.join(dataDir, 'failed-once'), request.turnId);
            return end({ kind: 'failed', error: { kind: 'other', message: 'echo failed once' } }, current);
          }
          emit({ kind: 'text', text: ` ${JSON.stringify({ session: request.session })}` });
          return end({ kind: 'completed', finishReason: 'stop' }, current);
        }
        case 'signed-out-blank':
          return end({ kind: 'failed', error: { kind: 'signed-out' } }, '', { sessionTouched: false });
        case 'leave-running':
          runtime.openCommand('/bin/sleep', { args: ['30'], cwd: request.cwd, files: [], scope: { kind: 'turn', turnId: request.turnId }, signal, onLine: () => undefined }).end();
          await new Promise((resolve) => setTimeout(resolve, 300));
          break;
        case 'route-changed':
          return end({ kind: 'failed', error: { kind: 'route-changed' } }, current, { sessionTouched: false });
        case 'session-lost':
          return end({ kind: 'failed', error: { kind: 'session-lost' } }, current);
        case 'final-only':
          return end({ kind: 'completed', finishReason: 'stop' }, current, { finalText: 'only the final text' });
        case 'usage':
          emit({
            kind: 'usage-update',
            observedAt: '2026-01-01T00:00:05.000Z',
            accountKey: current,
            windows: [{ id: 'five-hour', kind: 'session', scope: { kind: 'account' }, label: '5 hours', usedPercent: 40, resetsAt: null, windowMinutes: 300 }],
          });
          break;
        case 'describe':
          emit({ kind: 'text', text: ` ${JSON.stringify({ session: request.session, system: request.system, selection: request.selection, expectedAccountKey: request.expectedAccountKey })}` });
          return end({ kind: 'completed', finishReason: 'stop' }, current);
        case 'steerable': {
          const steered = await new Promise<string | null>((resolve) => {
            onSteer((steer) => {
              emit({ kind: 'steer-delivered', steerId: steer.steerId });
              resolve(steer.text);
            });
            signal.addEventListener('abort', () => { resolve(null); }, { once: true });
          });
          if (steered === null) return end({ kind: 'cancelled' }, current);
          emit({ kind: 'text', text: ` heard: ${steered}` });
          await runTools(toolCalls(steered, /^host-tool (\S+) (\{.*\})$/), undefined, false);
          return end({ kind: 'completed', finishReason: 'stop' }, current);
        }
        case 'tools-gate':
          emit({ kind: 'tool-start', toolUseId: 'read-1', name: 'Read', input: { file_path: 'notes.md' } });
          emit({ kind: 'tool-end', toolUseId: 'read-1', outcome: 'ok' });
          emit({ kind: 'tool-start', toolUseId: 'bash-1', name: 'Bash', input: { command: 'make test' } });
          while (!existsSync(path.join(dataDir, 'gate')) && !signal.aborted) await new Promise((resolve) => setTimeout(resolve, 20));
          if (signal.aborted) return end({ kind: 'cancelled' }, current);
          emit({ kind: 'tool-end', toolUseId: 'bash-1', outcome: 'error' });
          emit({ kind: 'text', text: ' tests failed' });
          return end({ kind: 'completed', finishReason: 'stop' }, current);
        case 'gate':
          while (!existsSync(path.join(dataDir, 'gate')) && !signal.aborted) await new Promise((resolve) => setTimeout(resolve, 20));
          return end(signal.aborted ? { kind: 'cancelled' } : { kind: 'completed', finishReason: 'stop' }, current);
        case 'sleep': {
          const command = runtime.openCommand('/bin/sleep', { args: ['30'], cwd: request.cwd, files: [], scope: { kind: 'turn', turnId: request.turnId }, signal, onLine: () => undefined });
          command.end();
          await command.exited;
          return end(signal.aborted ? { kind: 'cancelled' } : { kind: 'completed', finishReason: 'stop' }, current);
        }
        default:
          break;
      }
      for (let i = 0; i < Number(config.repeat); i += 1) emit({ kind: 'text', text: ` ${prompt}` });
      return end({ kind: 'completed', finishReason: 'stop' }, current, {
        usage: { kind: 'reported', inputTokens: 3, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: 2, reasoningTokens: null },
        actualModel: request.selection.kind === 'model' ? request.selection.id : 'tiny',
      });
    },
  }),
);
