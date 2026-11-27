import { openCommand, type ProviderError, type TurnContext, type TurnEnd } from '@morrowbot/plugin-sdk';
import { readAuth } from './auth.ts';
import { buildInvocation, type ClaudeAccess } from './invocation.ts';
import { checkManagedPolicy } from './policy.ts';
import { failed } from './reader.ts';
import { readVersion } from './version.ts';
import { createTurnWire, type UsageListener } from './wire.ts';

export interface TurnSettings {
  readonly cliPath: string;
  /** Shown as `~` in tool input and approval cards. */
  readonly home: string | null;
  readonly onUsage: UsageListener;
}

type Preflight =
  | { readonly kind: 'ok'; readonly accountKey: string; readonly access: ClaudeAccess }
  | { readonly kind: 'refused'; readonly end: TurnEnd };

/** Runs one stateless turn, after checking the CLI version, managed policy, account and access. */
export async function runTurn(context: TurnContext, settings: TurnSettings): Promise<TurnEnd> {
  const checked = await preflight(context, settings.cliPath);
  if (checked.kind === 'refused') return checked.end;
  const { request, signal } = context;
  const { accountKey, access } = checked;
  const seed = request.session.kind === 'new' ? request.session.seed : null;
  const { args, frame, files } = buildInvocation({ ...request, access, seed });
  const reader = createTurnWire({
    home: settings.home,
    accountKey,
    asks: access === 'workspace-write',
    ask: context.ask,
    emit: context.emit,
    onUsage: settings.onUsage,
    write: (line) => {
      command.write(line);
    },
    end: () => {
      command.end();
    },
  });
  const command = openCommand(settings.cliPath, {
    args,
    cwd: request.cwd,
    files,
    scope: { kind: 'turn', turnId: request.turnId },
    signal,
    onLine: (line) => {
      reader.read(line);
    },
  });
  command.write(frame);
  const exit = await command.exited;
  return reader.finish(exit, { cliPath: settings.cliPath, accountKey, cancelled: signal.aborted });
}

async function preflight({ request, signal }: TurnContext, cliPath: string): Promise<Preflight> {
  const refuse = (error: ProviderError): Preflight => ({
    kind: 'refused',
    end: {
      outcome: signal.aborted ? { kind: 'cancelled' } : failed(error),
      usage: { kind: 'unavailable' },
      actualModel: null,
      accountKey: request.expectedAccountKey,
      sessionTouched: false,
      finalText: null,
    },
  });
  if (request.session.kind === 'resume') return refuse({ kind: 'other', message: 'provider-claude is stateless' });
  const version = await readVersion(cliPath, request.cwd);
  switch (version.kind) {
    case 'supported':
      break;
    case 'missing':
      return refuse({ kind: 'not-installed' });
    case 'below':
      return refuse({ kind: 'outdated' });
    case 'above':
    case 'unreadable':
      return refuse({ kind: 'access-not-supported', reason: version.reason });
  }
  const policy = await checkManagedPolicy();
  if (policy.kind === 'withheld') return refuse({ kind: 'access-not-supported', reason: policy.reason });
  const auth = await readAuth(cliPath, request.cwd, signal);
  switch (auth.kind) {
    case 'personal':
      break;
    case 'signed-out':
      return refuse({ kind: 'signed-out' });
    case 'not-installed':
      return refuse({ kind: 'not-installed' });
    case 'failed':
      return refuse({ kind: 'other', message: auth.message });
    case 'withheld':
      return refuse({ kind: 'access-not-supported', reason: auth.reason });
  }
  if (auth.accountKey !== request.expectedAccountKey) return refuse({ kind: 'account-changed' });
  const access = request.access;
  if (access === 'full' || request.vendorSettings !== 'isolated') {
    return refuse({
      kind: 'access-not-supported',
      reason: `provider-claude runs read-only or workspace-write turns with MorrowBot's own instructions, not ${access} with ${request.vendorSettings} settings.`,
    });
  }
  if (signal.aborted) return refuse({ kind: 'other', message: 'cancelled' });
  return { kind: 'ok', accountKey: auth.accountKey, access };
}
