import type { ProviderError, TurnContext, TurnEnd, TurnRequest, UsageWindow } from '@morrowbot/plugin-sdk';
import type { CodexDaemon } from './daemon.ts';
import { READ_ONLY_SANDBOX } from './lockdown.ts';
import { mismatch, preflight, type PreflightDeps } from './preflight.ts';
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

export interface TurnDeps extends PreflightDeps {
  readonly daemon: () => CodexDaemon | undefined;
  readonly home: string | null;
  /** Hears plan usage read during the turn, already checked against its account and route. */
  readonly onUsage: (accountKey: string, observedAt: string, windows: readonly UsageWindow[]) => void;
}

/**
 * Runs one turn on the shared daemon: the preflight checks, then the thread (opened and checked),
 * the account and route again now that the thread holds its config, and only then the prompt.
 */
export async function runTurn(context: TurnContext, deps: TurnDeps): Promise<TurnEnd> {
  const { request, signal } = context;
  const stopped = (): boolean => signal.aborted;
  const refuse = (error: ProviderError, sessionTouched = false): TurnEnd => ({
    outcome: stopped() ? { kind: 'cancelled' } : { kind: 'failed', error },
    usage: { kind: 'unavailable' },
    actualModel: null,
    accountKey: request.expectedAccountKey,
    sessionTouched,
    finalText: null,
  });
  const cancelled = (): TurnEnd => refuse({ kind: 'other', message: 'cancelled' });
  const abort = new Promise<'stopped'>((resolveStop) => {
    if (stopped()) resolveStop('stopped');
    else signal.addEventListener('abort', () => { resolveStop('stopped'); }, { once: true });
  });
  const unlessStopped = <T>(work: Promise<T>): Promise<T | 'stopped'> => Promise.race([work, abort]);

  const checked = await unlessStopped(preflight(request, deps, deps.daemon()));
  if (checked === 'stopped') return cancelled();
  if (checked.kind === 'refused') return refuse(checked.error);
  const { daemon, accountKey, routeKey, subscription } = checked;
  const ephemeral = accountKey === '';
  if (ephemeral && request.session.kind === 'resume') return refuse({ kind: 'session-lost' });
  const opening = openThread(daemon, { cwd: request.cwd, session: request.session, ephemeral, routeKey, policy: checked.policy });
  const opened = await unlessStopped(opening);
  if (opened === 'stopped') {
    void opening.then((late) => {
      if (late.kind === 'opened' && (ephemeral || late.isNew)) releaseThread(daemon, late.threadId);
    });
    return cancelled();
  }
  if (opened.kind === 'refused') return refuse(opened.error);
  const { threadId, isNew, model } = opened;
  let ended = false;
  const session = { bound: false };
  try {
    const again = await unlessStopped(resolve(daemon, request.cwd));
    if (again === 'stopped') return cancelled();
    const changed = mismatch(request, again);
    if (changed !== null) return refuse(changed);
    return await prompt();
  } finally {
    ended = true;
    if (ephemeral || !session.bound) releaseThread(daemon, threadId);
  }

  async function prompt(): Promise<TurnEnd> {
    const lastTotal = daemon.lastTotal(threadId);
    const baseline: Baseline = isNew ? { kind: 'new-thread' } : lastTotal ? { kind: 'seen', total: lastTotal } : { kind: 'unknown' };
    let vendorTurn: string | null = null;
    const tokens = countTokens(baseline, () => vendorTurn);
    const quota: { pending: Promise<void> | null } = { pending: null };
    const stream = createTurnStream({
      threadId,
      home: deps.home,
      emit: context.emit,
      tokens,
      onAnnounced: (id) => {
        if (stopped()) interrupt(id);
      },
      onRateLimitHint: () => {
        if (!subscription || quota.pending !== null) return;
        quota.pending = readQuota(daemon, request.cwd)
          .then((read) => {
            if (read.kind !== 'available' || read.accountKey !== accountKey) return;
            deps.onUsage(read.accountKey, read.observedAt, read.windows);
            if (!ended) context.emit({ kind: 'usage-update', observedAt: read.observedAt, accountKey, windows: [...read.windows] });
          })
          .finally(() => {
            quota.pending = null;
          });
      },
    });
    const interrupted = new Set<string>();
    const interrupt = (turnId: string): void => {
      if (interrupted.has(turnId)) return;
      interrupted.add(turnId);
      void daemon.call('turn/interrupt', { threadId, turnId }, Ignored, INTERRUPT_MS);
    };
    const onStop = (): void => {
      const turnId = vendorTurn ?? stream.startedTurn();
      if (turnId !== null) interrupt(turnId);
    };
    const unlisten = daemon.listen((event) => {
      stream.hear(event);
    });
    signal.addEventListener('abort', onStop, { once: true });
    try {
      session.bound = true;
      if (isNew && !ephemeral) context.emit({ kind: 'session-bound', ref: threadId, accountKey, routeKey });
      const started = await daemon.call('turn/start', turnStart(request, threadId), TurnStartResponse, START_MS);
      if (started.kind === 'error') {
        daemon.loaded.delete(threadId);
        return refuse({ kind: 'other', message: `Codex did not start the turn: ${started.message}` });
      }
      const turnId = started.kind === 'ok' ? started.value.turn.id : stream.startedTurn();
      if (turnId === null) {
        // Codex may still run a prompt whose turn/start it never answered; only ending the daemon makes sure it does not.
        await daemon.close();
        return refuse({ kind: 'transient', retryAfterMs: null }, true);
      }
      vendorTurn = turnId;
      stream.begin(turnId);
      if (stopped()) interrupt(turnId);
      const finish: Finish = await stream.finished;
      if (!stopped() && finish.kind !== 'exited' && quota.pending !== null) await settleWithin(quota.pending, QUOTA_WAIT_MS);
      return {
        outcome: outcomeOf(finish, stopped()),
        usage: tokens.usage(),
        actualModel: stream.reroutedTo() ?? (request.selection.kind === 'model' ? request.selection.id : model),
        accountKey,
        sessionTouched: true,
        finalText: stream.finalText(),
      };
    } finally {
      signal.removeEventListener('abort', onStop);
      unlisten();
    }
  }
}

async function settleWithin(work: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work, new Promise<void>((done) => (timer = setTimeout(done, ms)))]);
  clearTimeout(timer);
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
