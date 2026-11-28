import { acp, type ProviderError, type TurnContext, type TurnEnd, type TurnOutcome, type TurnRequest, type TurnUsage } from '@morrowbot/plugin-sdk';
import { BUILD_MODE, FULL_MODE } from './config.ts';
import type { ModelCatalog } from './models.ts';
import { closeSession, configureSession, openSession, vendorError, type OpenCodeAccess } from './session.ts';

/** A prompt has no deadline of its own: Stop cancels it, and the host ends a daemon that ignores that. */
const PROMPT_MS = 24 * 60 * 60_000;
const NAME = 'OpenCode';

export interface TurnDeps {
  /** The running daemon and what this provider learned from it, or undefined. */
  readonly live: () => Live | undefined;
  /** Why the CLI cannot run turns now (missing, outdated or untested), or null. */
  readonly checkCli: (cwd: string) => Promise<ProviderError | null>;
  /** Why turns are held back now (managed opencode config), or null. */
  readonly checkManaged: () => Promise<string | null>;
  /** Why this OS is not supported, or null. */
  readonly platformReason: string | null;
  /** Shared one-shot breach fence for this provider run. */
  readonly fence: Pick<acp.Fence, 'reason' | 'subscribe'>;
  readonly home: string | null;
}

/** One daemon and what its sessions reported. */
export interface Live {
  readonly client: acp.AcpClient;
  readonly catalog: ModelCatalog;
}

/**
 * Runs one turn on the shared daemon: checks, a session in `build` (read-only) or `full` mode with
 * the picked model, then the prompt with the agent's instructions. Read-only turns offer no write or
 * shell tool, ask via approval card for reads/searches/fetches outside the workspace, deny anything
 * else, and end the daemon on any unasked change or mode switch. Full turns run in `full` mode with
 * permission prompts auto-allowed and without tripping the read-only fence.
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
  const fence = (): ProviderError | null => {
    const reason = deps.fence.reason();
    return reason === null ? null : { kind: 'access-not-supported', reason };
  };
  /** A refusal; once opencode broke the read-only rules, that is the reason, even after Stop. */
  const refuse = (error: ProviderError): TurnEnd => {
    const fenced = fence();
    if (fenced !== null) return ended({ kind: 'failed', error: fenced }, { sessionTouched: false });
    return ended(stopped() ? { kind: 'cancelled' } : { kind: 'failed', error }, { sessionTouched: false });
  };
  let stopAbort: (() => void) | undefined;
  const abort = new Promise<'stopped'>((resolveStop) => {
    if (stopped()) resolveStop('stopped');
    else {
      const onAbort = (): void => { resolveStop('stopped'); };
      signal.addEventListener('abort', onAbort, { once: true });
      stopAbort = () => { signal.removeEventListener('abort', onAbort); };
    }
  });
  const unlessStopped = <T>(work: Promise<T>): Promise<T | 'stopped'> => Promise.race([work, abort]);

  try {
    const checked = await unlessStopped(preflight(request, deps));
    if (checked === 'stopped') return ended({ kind: 'cancelled' }, { sessionTouched: false });
    if (checked.kind === 'refused') return refuse(checked.error);
    const { live, access } = checked;
    const { client } = live;
    const full = access === 'full';
    const targetMode = full ? FULL_MODE : BUILD_MODE;

    let armed = false;
    let over = false;
    /** Whether a permission was refused during the prompt: opencode then ends it as `cancelled` (checked on 2.4.1). */
    let denied = false;
    let sessionId: string | null = null;
    const cancelPrompt = (): void => {
      if (sessionId !== null && client.alive()) client.notify('session/cancel', { sessionId });
    };
    const turnFenced = Promise.withResolvers<string>();
    const stopFence = deps.fence.subscribe((reason) => {
      turnFenced.resolve(reason);
    });
    turnFenced.promise
      .then((reason) => {
        if (over || sessionId === null) return;
        emit({ kind: 'status', text: reason });
        cancelPrompt();
      })
      .catch((error: unknown) => {
        console.error('provider-opencode: could not stop a turn after opencode broke the read-only rules', error);
      });
    const turnFencedNull = turnFenced.promise.then(() => null);
    const stream = acp.createSessionStream({
      home: deps.home,
      mode: targetMode,
      emit,
      onBreach: (found) => {
        if (!full && armed) client.breach(found);
      },
    });
    /** No answer allows anything once opencode broke the rules, or after Stop. */
    const refusing = (): boolean => stopped() || deps.fence.reason() !== null;
    const answer = async (asked: acp.PermissionRequest): Promise<unknown> => {
      if (full) {
        if (refusing()) return acp.permissionResult(asked.options, null, true);
        return acp.permissionResult(asked.options, { kind: 'chosen', choiceId: 'allow' }, false);
      }
      const decision = acp.decide(asked, deps.home, NAME);
      if (decision.kind === 'deny') {
        denied = true;
        emit({ kind: 'status', text: decision.status });
        return acp.permissionResult(asked.options, null, stopped());
      }
      if (refusing()) return acp.permissionResult(asked.options, null, true);
      const chosen = await Promise.race([context.ask({ summary: `OpenCode wants to ${decision.summary}`, choices: acp.APPROVAL_CHOICES }), turnFencedNull]);
      const allowed = !refusing() && chosen?.kind === 'chosen' && chosen.choiceId === 'allow' && asked.options.some((option) => option.kind === 'allow_once');
      if (!allowed) denied = true;
      return refusing() ? acp.permissionResult(asked.options, null, true) : acp.permissionResult(asked.options, chosen, false);
    };
    const handlers: acp.SessionHandlers = {
      onUpdate: (update) => {
        stream.hear(update);
      },
      onPermission: answer,
      onRefused: (method) => {
        emit({
          kind: 'status',
          text: full ? `Refused OpenCode's ${method}: MorrowBot does not answer ${method}.` : `Refused OpenCode's ${method}: MorrowBot runs it read-only.`,
        });
      },
      replaying: () => false,
      allowChanges: full,
    };

    try {
      const opening = openSession(client, request.cwd, request.hostTools, handlers);
      const opened = await unlessStopped(opening);
      if (opened === 'stopped') {
        opening
          .then((late) => {
            if (late.kind !== 'opened') return;
            late.detach();
            closeSession(client, late.sessionId);
          })
          .catch((error: unknown) => {
            console.error('provider-opencode: could not close a session opened after Stop', error);
          });
        return ended({ kind: 'cancelled' }, { sessionTouched: false });
      }
      if (opened.kind === 'refused') return refuse(opened.error);
      sessionId = opened.sessionId;
      try {
        const earlyBreach = deps.fence.reason();
        if (earlyBreach !== null) {
          emit({ kind: 'status', text: earlyBreach });
          cancelPrompt();
          return refuse({ kind: 'access-not-supported', reason: earlyBreach });
        }
        const before = live.catalog.models();
        const configured = await unlessStopped(
          configureSession(client, opened.sessionId, opened.options, {
            access,
            selection: request.selection,
            catalog: live.catalog,
          }),
        );
        const after = live.catalog.models();
        if (after !== null && after !== before) emit({ kind: 'model-options-changed', models: [...after] });
        if (configured === 'stopped') return ended({ kind: 'cancelled' }, { sessionTouched: false });
        if (configured.kind === 'refused') return refuse(configured.error);
        armed = true;
        const mode = stream.mode();
        if (!full && mode !== null && mode !== BUILD_MODE) client.breach({ kind: 'mode-changed', mode });
        const fenceBefore = fence();
        if (fenceBefore !== null) return refuse(fenceBefore);
        return await prompt(opened.sessionId, configured.model);
      } finally {
        opened.detach();
        closeSession(client, opened.sessionId);
      }
    } finally {
      over = true;
      stopFence();
    }

    async function prompt(id: string, model: string | null): Promise<TurnEnd> {
      signal.addEventListener('abort', cancelPrompt, { once: true });
      try {
        if (stopped()) return ended({ kind: 'cancelled' }, { sessionTouched: false });
        const text = promptText(request);
        const reply = await Promise.race([client.call('session/prompt', { sessionId: id, prompt: acp.promptBlocks(text, request.images) }, acp.PromptResponse, PROMPT_MS), turnFencedNull]);
        const touched = { actualModel: model, sessionTouched: true };
        const fenceNow = fence();
        if (reply === null || fenceNow !== null) {
          const usage: TurnUsage = reply?.kind === 'ok' ? usageOf(reply.value) : { kind: 'unavailable' };
          const fallback = full ? 'The OpenCode daemon stopped after a session broke the read-only rules.' : 'OpenCode broke the read-only rules.';
          return ended({ kind: 'failed', error: fenceNow ?? { kind: 'access-not-supported', reason: fallback } }, { ...touched, usage });
        }
        switch (reply.kind) {
          case 'ok':
            return ended(outcomeOf(reply.value.stopReason, { stopped: stopped(), denied }), { ...touched, usage: usageOf(reply.value) });
          case 'error':
            return ended(stopped() ? { kind: 'cancelled' } : { kind: 'failed', error: vendorError(reply.message) }, touched);
          case 'unanswered':
            if (client.alive()) cancelPrompt();
            return ended({ kind: 'interrupted' }, touched);
        }
      } finally {
        signal.removeEventListener('abort', cancelPrompt);
      }
    }
  } finally {
    stopAbort?.();
  }
}

type Checked = { readonly kind: 'ok'; readonly live: Live; readonly access: OpenCodeAccess } | { readonly kind: 'refused'; readonly error: ProviderError };

/**
 * Checks a turn before any session opens: the access it asks for, the OS, the CLI, managed config,
 * the daemon, and the account. opencode reports no account, so the key is '' and only a turn
 * admitted for '' runs, always in a new session.
 */
async function preflight(request: TurnRequest, deps: TurnDeps): Promise<Checked> {
  const refused = (error: ProviderError): Checked => ({ kind: 'refused', error });
  if ((request.access !== 'read-only' && request.access !== 'full') || request.vendorSettings !== 'isolated') {
    return refused({
      kind: 'access-not-supported',
      reason: `provider-opencode runs read-only or full turns with MorrowBot's instructions, not ${request.access} with ${request.vendorSettings} settings.`,
    });
  }
  if (request.access === 'read-only' && request.mode !== 'interactive') return refused({ kind: 'background-not-allowed' });
  if (deps.platformReason !== null) return refused({ kind: 'access-not-supported', reason: deps.platformReason });
  const breach = deps.fence.reason();
  if (breach !== null) return refused({ kind: 'access-not-supported', reason: breach });
  const cli = await deps.checkCli(request.cwd);
  if (cli !== null) return refused(cli);
  const managed = await deps.checkManaged();
  if (managed !== null) return refused({ kind: 'access-not-supported', reason: managed });
  const live = deps.live();
  if (live?.client.alive() !== true) return refused({ kind: 'transient', retryAfterMs: null });
  if (request.expectedAccountKey !== '') return refused(request.expectedRouteKey === '' ? { kind: 'account-changed' } : { kind: 'route-changed' });
  if (request.expectedRouteKey !== '') return refused({ kind: 'route-changed' });
  if (request.session.kind !== 'new') return refused({ kind: 'session-lost' });
  return { kind: 'ok', live, access: request.access };
}

/**
 * How opencode's `stopReason` ends the turn. opencode 2.4.1 ends a prompt as `cancelled` when a
 * permission it asked for is refused, so that is a completed reply unless the host asked to stop.
 */
export function outcomeOf(stopReason: string, turn: { readonly stopped: boolean; readonly denied: boolean }): TurnOutcome {
  switch (stopReason) {
    case 'max_tokens':
      return { kind: 'completed', finishReason: 'length' };
    case 'max_turn_requests':
      return { kind: 'completed', finishReason: 'turn-limit' };
    case 'refusal':
      return { kind: 'completed', finishReason: 'refused' };
    case 'cancelled':
      if (turn.stopped) return { kind: 'cancelled' };
      return turn.denied ? { kind: 'completed', finishReason: 'stop' } : { kind: 'interrupted' };
    default:
      return { kind: 'completed', finishReason: 'stop' };
  }
}

/** opencode's token counts for the prompt. */
export function usageOf(response: acp.PromptResponse): TurnUsage {
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

/**
 * The prompt opencode gets: the agent's instructions (opencode loads none of the workspace's own),
 * then, in a seeded session, the earlier conversation (the host's `<user>` / `<assistant>` blocks).
 */
export function promptText(request: Pick<TurnRequest, 'system' | 'session' | 'prompt'>): string {
  const seed = request.session.kind === 'new' ? request.session.seed : null;
  const body =
    seed === null || seed === ''
      ? request.prompt
      : `Continue this conversation. Reply to the last user message.\n\n<conversation>\n${seed}\n<user>\n${request.prompt}\n</user>\n</conversation>`;
  const system = request.system.trim();
  return system === '' ? body : `<instructions>\n${system}\n</instructions>\n\n${body}`;
}
