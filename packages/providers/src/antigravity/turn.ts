import type { ProviderError, TurnContext, TurnEnd, TurnOutcome, TurnRequest, TurnUsage } from '@morrowbot/plugin-sdk';
import type { AcpDaemon, SessionHandlers } from './daemon.ts';
import type { ModelCatalog } from './models.ts';
import { APPROVAL_CHOICES, decide, permissionResult } from './permission.ts';
import { PromptResponse, type PermissionRequest } from './protocol.ts';
import { closeSession, configureSession, openSession, vendorError } from './session.ts';
import { createSessionStream, type Breach } from './session-stream.ts';

/** A prompt has no deadline of its own: Stop cancels it, and the host ends a daemon that ignores that. */
const PROMPT_MS = 24 * 60 * 60_000;

export interface TurnDeps {
  /** The running daemon and what this provider learned from it, or undefined. */
  readonly live: () => Live | undefined;
  /** Why the CLI cannot run turns now (missing, outdated or untested), or null. */
  readonly checkCli: (cwd: string) => Promise<ProviderError | null>;
  /** Why this OS is not supported, or null. */
  readonly platformReason: string | null;
  /** Why turns are no longer offered in this run, or null. */
  readonly breach: () => string | null;
  readonly onBreach: (reason: string) => void;
  readonly home: string | null;
}

/** One daemon and what its sessions reported. */
export interface Live {
  readonly daemon: AcpDaemon;
  readonly catalog: ModelCatalog;
  tier: string | null;
  signedOut: boolean;
}

/**
 * Runs one read-only turn on the shared daemon: checks, a session in Default mode with the picked
 * model, then the prompt. Every write and command agy asks for is denied; a read, search or fetch
 * it asks for goes to an approval card. If agy changes something without asking, the turn stops.
 */
export async function runTurn(context: TurnContext, deps: TurnDeps): Promise<TurnEnd> {
  const { request, signal, emit } = context;
  const stopped = (): boolean => signal.aborted;
  const ended = (outcome: TurnOutcome, more: { readonly usage?: TurnUsage; readonly actualModel?: string | null; readonly sessionTouched: boolean }): TurnEnd => ({
    outcome,
    usage: more.usage ?? { kind: 'unavailable' },
    actualModel: more.actualModel ?? null,
    accountKey: '',
    sessionTouched: more.sessionTouched,
    finalText: null,
  });
  const refuse = (error: ProviderError, sessionTouched = false): TurnEnd => ended(stopped() ? { kind: 'cancelled' } : { kind: 'failed', error }, { sessionTouched });
  const abort = new Promise<'stopped'>((resolveStop) => {
    if (stopped()) resolveStop('stopped');
    else signal.addEventListener('abort', () => { resolveStop('stopped'); }, { once: true });
  });
  const unlessStopped = <T>(work: Promise<T>): Promise<T | 'stopped'> => Promise.race([work, abort]);

  const checked = await unlessStopped(preflight(request, deps));
  if (checked === 'stopped') return ended({ kind: 'cancelled' }, { sessionTouched: false });
  if (checked.kind === 'refused') return refuse(checked.error);
  const { live } = checked;
  const { daemon } = live;

  let armed = false;
  let breached: string | null = null;
  let sessionId: string | null = null;
  const cancelPrompt = (): void => {
    if (sessionId !== null) daemon.notify('session/cancel', { sessionId });
  };
  const stream = createSessionStream({
    home: deps.home,
    emit,
    onBreach: (found) => {
      if (!armed || breached !== null) return;
      breached = breachReason(found, daemon.version);
      deps.onBreach(breached);
      emit({ kind: 'status', text: breached });
      cancelPrompt();
    },
  });
  const answer = async (asked: PermissionRequest): Promise<unknown> => {
    const decision = decide(asked, deps.home);
    if (decision.kind === 'deny') {
      emit({ kind: 'status', text: decision.status });
      return permissionResult(asked.options, null, stopped());
    }
    if (stopped() || breached !== null) return permissionResult(asked.options, null, stopped());
    const chosen = await context.ask({ summary: `Antigravity wants to ${decision.summary}`, choices: APPROVAL_CHOICES });
    return permissionResult(asked.options, chosen, stopped());
  };
  const handlers: SessionHandlers = {
    onUpdate: (update) => {
      stream.hear(update);
    },
    onPermission: answer,
    onRefused: (method) => {
      emit({ kind: 'status', text: `Refused Antigravity's ${method}: MorrowBot runs it read-only.` });
    },
  };

  const opening = openSession(daemon, request.cwd, request.session, handlers);
  const opened = await unlessStopped(opening);
  if (opened === 'stopped') {
    opening
      .then((late) => {
        if (late.kind !== 'opened') return;
        late.detach();
        closeSession(daemon, late.sessionId);
      })
      .catch((error: unknown) => {
        console.error('provider-antigravity: could not close a session opened after Stop', error);
      });
    return ended({ kind: 'cancelled' }, { sessionTouched: false });
  }
  if (opened.kind === 'refused') {
    if (opened.error.kind === 'signed-out') live.signedOut = true;
    return refuse(opened.error);
  }
  sessionId = opened.sessionId;
  live.signedOut = false;
  live.tier = opened.tier ?? live.tier;
  try {
    const before = live.catalog.models();
    const configured = await unlessStopped(configureSession(daemon, opened.sessionId, opened.options, request.selection, live.catalog, opened.isNew));
    const after = live.catalog.models();
    if (after !== null && after !== before) emit({ kind: 'model-options-changed', models: [...after] });
    if (configured === 'stopped') return ended({ kind: 'cancelled' }, { sessionTouched: false });
    if (configured.kind === 'refused') return refuse(configured.error);
    return await prompt(opened.sessionId, configured.model);
  } finally {
    opened.detach();
    closeSession(daemon, opened.sessionId);
  }

  async function prompt(id: string, model: string | null): Promise<TurnEnd> {
    armed = true;
    signal.addEventListener('abort', cancelPrompt, { once: true });
    try {
      if (stopped()) return ended({ kind: 'cancelled' }, { sessionTouched: false });
      const reply = await daemon.call('session/prompt', { sessionId: id, prompt: [{ type: 'text', text: promptText(request) }] }, PromptResponse, PROMPT_MS);
      const touched = { actualModel: model, sessionTouched: true };
      switch (reply.kind) {
        case 'ok': {
          const usage = usageOf(reply.value);
          if (breached !== null) return ended({ kind: 'failed', error: { kind: 'access-not-supported', reason: breached } }, { ...touched, usage });
          return ended(outcomeOf(reply.value.stopReason, stopped()), { ...touched, usage });
        }
        case 'error': {
          const error = vendorError(reply.code, reply.message);
          if (error.kind === 'signed-out') live.signedOut = true;
          if (breached !== null) return ended({ kind: 'failed', error: { kind: 'access-not-supported', reason: breached } }, touched);
          return ended(stopped() ? { kind: 'cancelled' } : { kind: 'failed', error }, touched);
        }
        case 'unanswered':
          if (daemon.alive()) cancelPrompt();
          return ended({ kind: 'interrupted' }, touched);
      }
    } finally {
      signal.removeEventListener('abort', cancelPrompt);
    }
  }
}

type Checked = { readonly kind: 'ok'; readonly live: Live } | { readonly kind: 'refused'; readonly error: ProviderError };

/**
 * Checks a turn before any session opens: the access it asks for, the OS, the CLI, the daemon, and
 * the account. agy reports no account, so the key is '' and only a turn admitted for '' runs.
 */
async function preflight(request: TurnRequest, deps: TurnDeps): Promise<Checked> {
  const refused = (error: ProviderError): Checked => ({ kind: 'refused', error });
  if (request.access !== 'read-only' || request.vendorSettings !== 'personal') {
    return refused({
      kind: 'access-not-supported',
      reason: `provider-antigravity runs read-only turns with the workspace's own instructions in v1, not ${request.access} with ${request.vendorSettings} settings.`,
    });
  }
  if (request.mode !== 'interactive') return refused({ kind: 'background-not-allowed' });
  if (deps.platformReason !== null) return refused({ kind: 'access-not-supported', reason: deps.platformReason });
  const breach = deps.breach();
  if (breach !== null) return refused({ kind: 'access-not-supported', reason: breach });
  const cli = await deps.checkCli(request.cwd);
  if (cli !== null) return refused(cli);
  const live = deps.live();
  if (live?.daemon.alive() !== true) return refused({ kind: 'transient', retryAfterMs: null });
  if (request.expectedAccountKey !== '') return refused(request.expectedRouteKey === '' ? { kind: 'account-changed' } : { kind: 'route-changed' });
  if (request.expectedRouteKey !== '') return refused({ kind: 'route-changed' });
  return { kind: 'ok', live };
}

/** How agy's `stopReason` ends the turn. `cancelled` only when the host asked to stop. */
export function outcomeOf(stopReason: string, cancelled: boolean): TurnOutcome {
  switch (stopReason) {
    case 'max_tokens':
      return { kind: 'completed', finishReason: 'length' };
    case 'max_turn_requests':
      return { kind: 'completed', finishReason: 'turn-limit' };
    case 'refusal':
      return { kind: 'completed', finishReason: 'refused' };
    case 'cancelled':
      return cancelled ? { kind: 'cancelled' } : { kind: 'interrupted' };
    default:
      return { kind: 'completed', finishReason: 'stop' };
  }
}

/** agy's token counts for the prompt. Its `inputTokens` already leaves out cached reads (checked on 1.5.18). */
export function usageOf(response: PromptResponse): TurnUsage {
  const { usage } = response;
  if (usage === null || usage === undefined) return { kind: 'unavailable' };
  return {
    kind: 'reported',
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedReadTokens ?? null,
    cacheWriteTokens: usage.cachedWriteTokens ?? null,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.thoughtTokens ?? null,
  };
}

function breachReason(breach: Breach, version: string | null): string {
  const agy = version === null ? 'agy' : `agy ${version}`;
  const what = breach.kind === 'unasked-change' ? `ran "${breach.tool}" without asking` : `left its Default mode for "${breach.mode}"`;
  return `Antigravity (${agy}) ${what}. MorrowBot stopped the turn and offers no Antigravity turns until it restarts.`;
}

/** A seeded new session gets the earlier conversation (the host's `<user>` / `<assistant>` blocks) before the prompt. */
function promptText(request: TurnRequest): string {
  const seed = request.session.kind === 'new' ? request.session.seed : null;
  if (seed === null || seed === '') return request.prompt;
  return `Continue this conversation. Reply to the last user message.\n\n<conversation>\n${seed}\n<user>\n${request.prompt}\n</user>\n</conversation>`;
}
