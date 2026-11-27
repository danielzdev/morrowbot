import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defineProvider, runPlugin, type AccessProfile, type PluginConfig, type TurnEnd } from '@morrowbot/plugin-sdk';

/**
 * A test provider. It answers with its greeting and the prompt; some prompts pick a behavior.
 * The `account` file in its data folder, when present, overrides the account it is signed in to.
 * With `sessions` on it keeps fake vendor sessions, so the host's session rules can be exercised.
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
    turn: async ({ request, signal, emit }) => {
      const current = account();
      if (request.expectedAccountKey !== '' && current !== request.expectedAccountKey) {
        return end({ kind: 'failed', error: { kind: 'account-changed' } }, current, { sessionTouched: false });
      }
      const { prompt } = request;
      if (keepsSessions() && request.session.kind === 'new' && request.expectedAccountKey !== '') {
        emit({ kind: 'session-bound', ref: `ref-${request.turnId}`, accountKey: current, routeKey: request.expectedRouteKey });
      }
      emit({ kind: 'text', text: `${String(config.greeting)} from pid ${String(process.pid)}:` });
      if (prompt.endsWith('describe-input')) {
        const images = request.images.map(({ mimeType, data }) => ({ mimeType, bytes: Buffer.from(data, 'base64').length }));
        emit({ kind: 'text', text: ` ${JSON.stringify({ prompt, images })}` });
        return end({ kind: 'completed', finishReason: 'stop' }, current);
      }
      switch (prompt) {
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
