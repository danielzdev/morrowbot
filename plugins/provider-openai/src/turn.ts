import type { ProviderError, TurnContext, TurnEnd, TurnRequest, UsageWindow } from '@morrowbot/plugin-sdk';
import type { CodexDaemon } from './daemon.ts';
import { READ_ONLY_SANDBOX, threadPolicy } from './lockdown.ts';
import { Ignored, TurnStartResponse } from './protocol.ts';
import { resolve } from './route.ts';
import { openThread, releaseThread } from './threads.ts';
import { countTokens, type Baseline } from './tokens.ts';
import { createTurnStream, outcomeOf, type Finish } from './turn-stream.ts';
import { readQuota } from './usage.ts';

const START_MS = 30_000;
const INTERRUPT_MS = 5_000;
/** How long turn-end waits for a usage read a rate-limit notification started. */
const QUOTA_WAIT_MS = 3_000;

export interface TurnDeps {
  readonly daemon: () => CodexDaemon | undefined;
  /** Why the CLI cannot run turns now (missing, outdated or untested), or null. */
  readonly checkCli: (cwd: string) => Promise<ProviderError | null>;
  /** Why this OS is not supported, or null. */
  readonly platformReason: string | null;
  readonly home: string | null;
  /** Hears plan usage read during the turn, already checked against its account and route. */
  readonly onUsage: (accountKey: string, observedAt: string, windows: readonly UsageWindow[]) => void;
}

type Checked = { readonly kind: 'ok'; readonly accountKey: string; readonly routeKey: string; readonly subscription: boolean; readonly policy: ReturnType<typeof threadPolicy> };

/**
 * Runs one turn on the shared daemon: checks the access, the CLI, then the account and route from one
 * snapshot (signed out, then account changed, then route changed), opens the thread and streams it.
 */
export async function runTurn(context: TurnContext, deps: TurnDeps): Promise<TurnEnd> {
  const { request, signal } = context;
  const stopped = (): boolean => signal.aborted;
  const refuse = (error: ProviderError): TurnEnd => ({
    outcome: stopped() ? { kind: 'cancelled' } : { kind: 'failed', error },
    usage: { kind: 'unavailable' },
    actualModel: null,
    accountKey: request.expectedAccountKey,
    sessionTouched: false,
    finalText: null,
  });
  const daemon = deps.daemon();
  const checked = await preflight(request, deps, daemon);
  if (checked.kind === 'refused') return refuse(checked.error);
  if (daemon === undefined) return refuse({ kind: 'transient', retryAfterMs: null });
  const { accountKey, routeKey } = checked;
  const ephemeral = accountKey === '';
  if (ephemeral && request.session.kind === 'resume') return refuse({ kind: 'session-lost' });
  if (stopped()) return refuse({ kind: 'other', message: 'cancelled' });
  const opened = await openThread(daemon, { cwd: request.cwd, session: request.session, ephemeral, routeKey, policy: checked.policy });
  if (opened.kind === 'refused') return refuse(opened.error);
  const { threadId } = opened;
  const done = (end: TurnEnd): TurnEnd => {
    if (ephemeral) releaseThread(daemon, threadId);
    return end;
  };
  if (stopped()) return done(refuse({ kind: 'other', message: 'cancelled' }));

  const lastTotal = daemon.lastTotal(threadId);
  const baseline: Baseline = opened.isNew ? { kind: 'new-thread' } : lastTotal ? { kind: 'seen', total: lastTotal } : { kind: 'unknown' };
  let vendorTurn: string | null = null;
  const tokens = countTokens(baseline, () => vendorTurn);
  const quota: { pending: Promise<void> | null } = { pending: null };
  const stream = createTurnStream({
    threadId,
    home: deps.home,
    emit: context.emit,
    tokens,
    onRateLimitHint: () => {
      if (!checked.subscription || quota.pending !== null) return;
      quota.pending = readQuota(daemon, request.cwd).then((read) => {
        if (read.kind !== 'available' || read.accountKey !== accountKey) return;
        deps.onUsage(read.accountKey, read.observedAt, read.windows);
        context.emit({ kind: 'usage-update', observedAt: read.observedAt, accountKey, windows: [...read.windows] });
      });
    },
  });
  const unlisten = daemon.listen((event) => {
    stream.hear(event);
  });
  try {
    if (opened.isNew && !ephemeral) context.emit({ kind: 'session-bound', ref: threadId, accountKey, routeKey });
    const started = await daemon.call('turn/start', turnStart(request, threadId), TurnStartResponse, START_MS);
    if (started.kind !== 'ok') {
      const message = started.kind === 'error' ? `Codex did not start the turn: ${started.message}` : started.reason;
      return done({ ...refuse({ kind: 'other', message }), sessionTouched: started.kind !== 'error' });
    }
    vendorTurn = started.value.turn.id;
    stream.begin(vendorTurn);
    const interrupt = (): void => {
      void daemon.call('turn/interrupt', { threadId, turnId: started.value.turn.id }, Ignored, INTERRUPT_MS);
    };
    if (stopped()) interrupt();
    else signal.addEventListener('abort', interrupt, { once: true });
    const finish: Finish = await stream.finished;
    signal.removeEventListener('abort', interrupt);
    if (quota.pending !== null) await Promise.race([quota.pending, new Promise((resolve) => setTimeout(resolve, QUOTA_WAIT_MS))]);
    return done({
      outcome: outcomeOf(finish, stopped()),
      usage: tokens.usage(),
      actualModel: stream.reroutedTo() ?? (request.selection.kind === 'model' ? request.selection.id : opened.model),
      accountKey,
      sessionTouched: true,
      finalText: stream.finalText(),
    });
  } finally {
    unlisten();
  }
}

async function preflight(
  request: TurnRequest,
  deps: TurnDeps,
  daemon: CodexDaemon | undefined,
): Promise<Checked | { readonly kind: 'refused'; readonly error: ProviderError }> {
  const refused = (error: ProviderError) => ({ kind: 'refused', error }) as const;
  if (request.access !== 'read-only' || request.vendorSettings !== 'personal') {
    return refused({
      kind: 'access-not-supported',
      reason: `provider-openai runs read-only turns with your own Codex instructions in v1, not ${request.access} with ${request.vendorSettings} settings.`,
    });
  }
  if (deps.platformReason !== null) return refused({ kind: 'access-not-supported', reason: deps.platformReason });
  const cli = await deps.checkCli(request.cwd);
  if (cli !== null) return refused(cli);
  if (daemon === undefined || !daemon.alive()) return refused({ kind: 'transient', retryAfterMs: null });
  const resolution = await resolve(daemon, request.cwd);
  switch (resolution.kind) {
    case 'failed':
      return refused({ kind: 'other', message: resolution.reason });
    case 'signed-out':
      return refused({ kind: 'signed-out' });
    case 'resolved':
      break;
  }
  const { accountKey, routeKey } = resolution;
  if (accountKey !== request.expectedAccountKey) {
    if (request.expectedAccountKey === '') return refused({ kind: 'route-changed' });
    if (accountKey !== '' || routeKey === request.expectedRouteKey) return refused({ kind: 'account-changed' });
    return refused({ kind: 'route-changed' });
  }
  if (routeKey !== request.expectedRouteKey) return refused({ kind: 'route-changed' });
  return { kind: 'ok', accountKey, routeKey, subscription: resolution.route.kind === 'subscription', policy: threadPolicy(resolution.config) };
}

function turnStart(request: TurnRequest, threadId: string): Readonly<Record<string, unknown>> {
  const { selection } = request;
  const effort = selection.kind === 'model' ? selection.choices.reasoningEffort : undefined;
  return {
    threadId,
    input: [{ type: 'text', text: promptText(request), text_elements: [] }],
    sandboxPolicy: READ_ONLY_SANDBOX,
    approvalPolicy: 'never',
    ...(selection.kind === 'model' ? { model: selection.id } : {}),
    ...(effort === undefined ? {} : { effort }),
  };
}

/** A seeded new thread gets the earlier conversation (the host's `<user>` / `<assistant>` blocks) before the prompt. */
function promptText(request: TurnRequest): string {
  const seed = request.session.kind === 'new' ? request.session.seed : null;
  if (seed === null || seed === '') return request.prompt;
  return `Continue this conversation. Reply to the last user message.\n\n<conversation>\n${seed}\n<user>\n${request.prompt}\n</user>\n</conversation>`;
}
