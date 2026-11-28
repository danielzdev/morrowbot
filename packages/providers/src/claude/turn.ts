import type { PluginRuntime, ProviderError, Steer, TurnContext, TurnEnd } from '@morrowbot/plugin-sdk';
import { readAuth } from './auth.ts';
import { effortOf, platformReason, type EffortLevel } from './info.ts';
import { buildInvocation, steerFrame } from './invocation.ts';
import { checkManagedPolicy, systemScope } from './policy.ts';
import { failed } from './reader.ts';
import { readVersion } from './version.ts';
import { createTurnWire, type UsageListener } from './wire.ts';

export interface TurnSettings {
  readonly runtime: PluginRuntime;
  readonly cliPath: string;
  /** Shown as `~` in tool input and approval cards. */
  readonly home: string | null;
  readonly onUsage: UsageListener;
}

type Preflight =
  | { readonly kind: 'ok'; readonly accountKey: string; readonly effort: EffortLevel | null }
  | { readonly kind: 'refused'; readonly end: TurnEnd };

/** Runs one stateless turn, after checking the CLI version, managed policy, account and access. */
export async function runTurn(context: TurnContext, settings: TurnSettings): Promise<TurnEnd> {
  const early: Steer[] = [];
  let steer = (incoming: Steer): void => {
    early.push(incoming);
  };
  context.onSteer((incoming) => {
    steer(incoming);
  });
  const checked = await preflight(context, settings.runtime, settings.cliPath);
  if (checked.kind === 'refused') return checked.end;
  const { request, signal } = context;
  const { accountKey, effort } = checked;
  const seed = request.session.kind === 'new' ? request.session.seed : null;
  const { args, frame, files } = buildInvocation({ ...request, seed, effort });
  const reader = createTurnWire({
    home: settings.home,
    accountKey,
    asks: request.access === 'workspace-write',
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
  const command = settings.runtime.openCommand(settings.cliPath, {
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
  /** A steer after the last `result` is left alone: the host sends it as the next turn. */
  steer = (incoming) => {
    const uuid = crypto.randomUUID();
    if (reader.expect(uuid, incoming.steerId)) command.write(steerFrame(incoming.text, uuid));
  };
  for (const incoming of early.splice(0)) steer(incoming);
  const exit = await command.exited;
  return reader.finish(exit, { cliPath: settings.cliPath, accountKey, cancelled: signal.aborted });
}

async function preflight({ request, signal }: TurnContext, runtime: PluginRuntime, cliPath: string): Promise<Preflight> {
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
  const effort = effortOf(request.selection);
  if (effort.kind === 'unsupported') return refuse({ kind: 'other', message: effort.reason });
  const version = await readVersion(runtime, cliPath, request.cwd);
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
  const policy = await checkManagedPolicy(systemScope(runtime));
  if (policy.kind === 'withheld') return refuse({ kind: 'access-not-supported', reason: policy.reason });
  const auth = await readAuth(runtime, cliPath, request.cwd, signal);
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
  if (request.vendorSettings !== 'isolated') {
    return refuse({ kind: 'access-not-supported', reason: `provider-claude runs turns with Ori Bot's own instructions, not ${request.vendorSettings} settings.` });
  }
  const held = platformReason(request.access, runtime.platform);
  if (held !== null) return refuse({ kind: 'access-not-supported', reason: held });
  const atLaunch = await checkManagedPolicy(systemScope(runtime));
  if (atLaunch.kind === 'withheld') return refuse({ kind: 'access-not-supported', reason: atLaunch.reason });
  if (signal.aborted) return refuse({ kind: 'other', message: 'cancelled' });
  return { kind: 'ok', accountKey: auth.accountKey, effort: effort.kind === 'level' ? effort.level : null };
}
