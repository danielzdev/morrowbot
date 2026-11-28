import { acp, type ApprovalAnswer, type ProviderError, type TurnContext, type TurnEnd, type TurnOutcome, type TurnRequest, type TurnUsage } from '@morrowbot/plugin-sdk';
import type { AcpDaemon } from './daemon.ts';
import type { ModelCatalog } from './models.ts';
import { bridgeHostTools, closeBridge, isHostTool } from './host-tools.ts';
import { ASKING_MODE, closeSession, configureSession, openSession, vendorError } from './session.ts';
import type { WorkspaceCheck } from './workspace.ts';

/** What a full-access turn answers every permission request with, and any turn a call to Ori Bot's own tools: allowed once, never always, so no grant outlives the turn. */
const ALLOW: ApprovalAnswer = { kind: 'chosen', choiceId: 'allow' };

/** A prompt has no deadline of its own: Stop cancels it, and the host ends a daemon that ignores that. */
const PROMPT_MS = 24 * 60 * 60_000;

export interface TurnDeps {
  /** The running daemon and what this provider learned from it, or undefined. */
  readonly live: () => Live | undefined;
  /** Why the CLI cannot run turns now (missing, outdated or untested), or null. */
  readonly checkCli: (cwd: string) => Promise<ProviderError | null>;
  /** Whether agy would load customizations that run code in the turn's workspace. */
  readonly checkWorkspace: (cwd: string, signal: AbortSignal) => Promise<WorkspaceCheck>;
  /** Why this OS is not supported, or null. */
  readonly platformReason: string | null;
  /** Shared one-shot breach fence for this provider run. */
  readonly fence: Pick<acp.Fence, 'reason' | 'subscribe'>;
  readonly home: string | null;
}

/** One daemon and what its sessions reported. */
export interface Live {
  readonly daemon: AcpDaemon;
  readonly catalog: ModelCatalog;
  tier: string | null;
  signedOut: boolean;
  /** Whether a probe has tried every model, so each one's thinking levels are known. */
  probed: boolean;
}

/**
 * Runs one turn on the shared daemon: checks, a session in Default mode with the picked model, then
 * the prompt. Read-only: every write and command agy asks for is denied; a read, search or fetch it
 * asks for goes to an approval card. If agy changes something without asking or leaves Default
 * mode, the daemon ends at once, so nothing on it runs on. Full: everything agy asks for is allowed
 * once, without a card, and its session is not fenced. Either way a call to Ori Bot's own tools is
 * allowed once without a card, and the turn's tools bridge ends with the turn. Stop sends
 * `session/cancel` either way.
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
  /** A refusal; once agy broke the read-only rules, that is the reason, even after Stop. */
  const refuse = (error: ProviderError, sessionTouched = false): TurnEnd => {
    const fenced = fence();
    if (fenced !== null) return ended({ kind: 'failed', error: fenced }, { sessionTouched });
    return ended(stopped() ? { kind: 'cancelled' } : { kind: 'failed', error }, { sessionTouched });
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
    const checked = await unlessStopped(preflight(request, deps, signal));
    if (checked === 'stopped') return ended({ kind: 'cancelled' }, { sessionTouched: false });
    if (checked.kind === 'refused') return refuse(checked.error);
    const { live } = checked;
    const { daemon } = live;
    const full = request.access === 'full';
    const bridged = await bridgeHostTools(request.hostTools);
    if (bridged.kind === 'refused') return refuse(bridged.error);
    const { bridge } = bridged;

    let armed = false;
    let over = false;
    let sessionId: string | null = null;
    const cancelPrompt = (): void => {
      if (sessionId !== null && daemon.alive()) daemon.notify('session/cancel', { sessionId });
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
        console.error('provider-antigravity: could not stop a turn after agy broke the read-only rules', error);
      });
    const turnFencedNull = turnFenced.promise.then(() => null);
    const stream = acp.createSessionStream({
      home: deps.home,
      mode: ASKING_MODE,
      emit,
      onBreach: (found) => {
        if (armed && !full) daemon.breach(found);
      },
    });
    /** No answer allows anything once agy broke the rules, or after Stop. */
    const refusing = (): boolean => stopped() || deps.fence.reason() !== null;
    const answer = async (asked: acp.PermissionRequest): Promise<unknown> => {
      if (full || isHostTool(asked)) return refusing() ? acp.permissionResult(asked.options, null, true) : acp.permissionResult(asked.options, ALLOW, false);
      const decision = acp.decide(asked, deps.home, 'Antigravity');
      if (decision.kind === 'deny') {
        emit({ kind: 'status', text: decision.status });
        return acp.permissionResult(asked.options, null, stopped());
      }
      if (refusing()) return acp.permissionResult(asked.options, null, true);
      const chosen = await Promise.race([context.ask({ summary: `Antigravity wants to ${decision.summary}`, choices: acp.APPROVAL_CHOICES }), turnFencedNull]);
      return refusing() ? acp.permissionResult(asked.options, null, true) : acp.permissionResult(asked.options, chosen, false);
    };
    const handlers: acp.SessionHandlers = {
      onUpdate: (update) => {
        stream.hear(update);
      },
      onPermission: answer,
      onRefused: (method) => {
        emit({ kind: 'status', text: full ? `Refused Antigravity's ${method}: Ori Bot offers it no file or terminal access of its own.` : `Refused Antigravity's ${method}: Ori Bot runs it read-only.` });
      },
      replaying: () => false,
      allowChanges: full,
    };

    try {
      const opening = openSession(daemon, request.cwd, request.session, bridge.servers, handlers);
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
        const earlyBreach = deps.fence.reason();
        if (earlyBreach !== null) {
          emit({ kind: 'status', text: earlyBreach });
          cancelPrompt();
          return refuse({ kind: 'access-not-supported', reason: earlyBreach });
        }
        const before = live.catalog.models();
        const setup = { selection: request.selection, catalog: live.catalog, fresh: opened.isNew, forgetMode: () => { stream.forgetMode(); } };
        const configured = await unlessStopped(configureSession(daemon, opened.sessionId, opened.options, setup));
        const after = live.catalog.models();
        if (after !== null && after !== before) emit({ kind: 'model-options-changed', models: [...after] });
        if (configured === 'stopped') return ended({ kind: 'cancelled' }, { sessionTouched: false });
        if (configured.kind === 'refused') {
          if (configured.error.kind === 'signed-out') live.signedOut = true;
          return refuse(configured.error);
        }
        armed = true;
        const mode = stream.mode();
        if (!full && mode !== null && mode !== ASKING_MODE) daemon.breach({ kind: 'mode-changed', mode });
        const fenceBefore = fence();
        if (fenceBefore !== null) return refuse(fenceBefore);
        if (!full) {
          const again = await unlessStopped(deps.checkWorkspace(request.cwd, signal));
          if (again === 'stopped') return ended({ kind: 'cancelled' }, { sessionTouched: false });
          const changed = workspaceError(again, deps.home) ?? fence();
          if (changed !== null) return refuse(changed);
        }
        return await prompt(opened.sessionId, configured.model);
      } finally {
        opened.detach();
        closeSession(daemon, opened.sessionId);
      }
    } finally {
      over = true;
      stopFence();
      await closeBridge(bridge);
    }

    async function prompt(id: string, model: string | null): Promise<TurnEnd> {
      signal.addEventListener('abort', cancelPrompt, { once: true });
      try {
        if (stopped()) return ended({ kind: 'cancelled' }, { sessionTouched: false });
        const reply = await Promise.race([daemon.call('session/prompt', { sessionId: id, prompt: acp.promptBlocks(promptText(request), request.images) }, acp.PromptResponse, PROMPT_MS), turnFencedNull]);
        const touched = { actualModel: model, sessionTouched: true };
        const fenceNow = fence();
        if (reply === null || fenceNow !== null) {
          const usage: TurnUsage = reply?.kind === 'ok' ? usageOf(reply.value) : { kind: 'unavailable' };
          return ended({ kind: 'failed', error: fenceNow ?? { kind: 'access-not-supported', reason: 'Antigravity broke the read-only rules.' } }, { ...touched, usage });
        }
        switch (reply.kind) {
          case 'ok':
            return ended(outcomeOf(reply.value.stopReason, stopped()), { ...touched, usage: usageOf(reply.value) });
          case 'error': {
            const error = vendorError(reply.code, reply.message);
            if (error.kind === 'signed-out') live.signedOut = true;
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
  } finally {
    stopAbort?.();
  }
}

type Checked = { readonly kind: 'ok'; readonly live: Live } | { readonly kind: 'refused'; readonly error: ProviderError };

/**
 * Checks a turn before any session opens: the access it asks for, the OS, the CLI, the workspace
 * (read-only only: full access may run the workspace's own hooks), the daemon, and the account. agy
 * reports no account, so the key is '' and only a turn admitted for '' runs.
 */
async function preflight(request: TurnRequest, deps: TurnDeps, signal: AbortSignal): Promise<Checked> {
  const refused = (error: ProviderError): Checked => ({ kind: 'refused', error });
  if (request.access === 'workspace-write' || request.vendorSettings !== 'personal') {
    return refused({
      kind: 'access-not-supported',
      reason: `provider-antigravity runs read-only and full turns with the workspace's own instructions in v1, not ${request.access} with ${request.vendorSettings} settings.`,
    });
  }
  if (request.access === 'read-only' && request.mode !== 'interactive') return refused({ kind: 'background-not-allowed' });
  if (deps.platformReason !== null) return refused({ kind: 'access-not-supported', reason: deps.platformReason });
  const breach = deps.fence.reason();
  if (breach !== null) return refused({ kind: 'access-not-supported', reason: breach });
  const cli = await deps.checkCli(request.cwd);
  if (cli !== null) return refused(cli);
  if (request.access === 'read-only') {
    const workspace = workspaceError(await deps.checkWorkspace(request.cwd, signal), deps.home);
    if (workspace !== null) return refused(workspace);
  }
  const late = deps.fence.reason();
  if (late !== null) return refused({ kind: 'access-not-supported', reason: late });
  const live = deps.live();
  if (live?.daemon.alive() !== true) return refused({ kind: 'transient', retryAfterMs: null });
  if (request.expectedAccountKey !== '') return refused(request.expectedRouteKey === '' ? { kind: 'account-changed' } : { kind: 'route-changed' });
  if (request.expectedRouteKey !== '') return refused({ kind: 'route-changed' });
  return { kind: 'ok', live };
}

/** Why agy cannot run read-only in the workspace, or null when it can. */
function workspaceError(check: WorkspaceCheck, home: string | null): ProviderError | null {
  switch (check.kind) {
    case 'clear':
      return null;
    case 'customized':
      return {
        kind: 'access-not-supported',
        reason: `Antigravity runs the hooks in ${acp.tilde(check.folder, home)} (and its plugins and MCP servers) without asking (checked on agy 1.5.18), so Ori Bot cannot run it read-only there. Move that folder out of the workspace to chat with Antigravity.`,
      };
    case 'unknown':
      return { kind: 'access-not-supported', reason: check.reason };
  }
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
 * The prompt agy gets: the agent's SOUL.md (agy loads only the workspace's AGENTS.md by itself), then, in a
 * seeded session, the earlier conversation (the host's `<user>` / `<assistant>` blocks). Every turn is a new
 * session, so each one carries the instructions.
 */
function promptText(request: Pick<TurnRequest, 'system' | 'session' | 'prompt'>): string {
  const seed = request.session.kind === 'new' ? request.session.seed : null;
  const body =
    seed === null || seed === ''
      ? request.prompt
      : `Continue this conversation. Reply to the last user message.\n\n<conversation>\n${seed}\n<user>\n${request.prompt}\n</user>\n</conversation>`;
  const system = request.system.trim();
  return system === '' ? body : `<instructions>\n${system}\n</instructions>\n\n${body}`;
}
