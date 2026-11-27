import { runCommand, type ProviderError, type TurnContext, type TurnEnd } from '@morrowbot/plugin-sdk';
import { readAuth } from './auth.ts';
import { buildInvocation } from './invocation.ts';
import { checkManagedPolicy } from './policy.ts';
import { createTurnReader, failed } from './reader.ts';
import { readVersion } from './version.ts';

export interface TurnSettings {
  readonly cliPath: string;
  /** Shown as `~` in tool input. */
  readonly home: string | null;
}

type Preflight = { readonly kind: 'ok'; readonly accountKey: string } | { readonly kind: 'refused'; readonly end: TurnEnd };

/** Runs one stateless, read-only turn, after checking the CLI version, managed policy, account and access. */
export async function runTurn(context: TurnContext, settings: TurnSettings): Promise<TurnEnd> {
  const checked = await preflight(context, settings.cliPath);
  if (checked.kind === 'refused') return checked.end;
  const { request, signal } = context;
  const { accountKey } = checked;
  const seed = request.session.kind === 'new' ? request.session.seed : null;
  const { args, input, files } = buildInvocation({ ...request, seed });
  const reader = createTurnReader({ home: settings.home }, (chunk) => {
    context.emit(chunk);
  });
  const exit = await runCommand(settings.cliPath, {
    args,
    cwd: request.cwd,
    input,
    files,
    scope: { kind: 'turn', turnId: request.turnId },
    signal,
    onLine: (line) => {
      reader.read(line);
    },
  });
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
  if (request.access !== 'read-only' || request.vendorSettings !== 'isolated') {
    return refuse({
      kind: 'access-not-supported',
      reason: `provider-claude runs only read-only turns with MorrowBot's own instructions, not ${request.access} with ${request.vendorSettings} settings.`,
    });
  }
  if (signal.aborted) return refuse({ kind: 'other', message: 'cancelled' });
  return { kind: 'ok', accountKey: auth.accountKey };
}
