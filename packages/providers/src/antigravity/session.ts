import { acp, type ModelSelection, type ProviderError, type TurnSession } from '@morrowbot/plugin-sdk';
import type { AcpDaemon } from './daemon.ts';
import { MODEL, THOUGHT, type ModelCatalog } from './models.ts';
import { SessionLoadResponse, SessionNewResponse } from './protocol.ts';

/** agy's mode that asks before every edit and command (`approval-required`). */
export const ASKING_MODE = 'default';

const OPEN_MS = 60_000;
const SET_MS = 15_000;
const CLOSE_MS = 5_000;
/** The ACP answer to a permission request Ori Kami does not ask about. */
const CANCELLED = { outcome: { outcome: 'cancelled' } };
const SESSION_GONE = /not found|no such|does not exist|unknown session/i;
const SIGNED_OUT = /authentication required|not (logged|signed) in|unauthenticated/i;
/** ACP's "authentication required" error code, which agy 1.5.18 answers `session/new` with when signed out. */
const AUTH_REQUIRED = -32000;

export type Opened =
  | {
      readonly kind: 'opened';
      readonly sessionId: string;
      readonly isNew: boolean;
      readonly options: readonly acp.ConfigOption[];
      /** The plan agy reports for the signed-in account, such as "Google AI Ultra". */
      readonly tier: string | null;
      readonly detach: () => void;
    }
  | { readonly kind: 'refused'; readonly error: ProviderError };

/**
 * Opens the turn's session: `session/new` in `cwd` with no MCP servers, or `session/load` of a saved
 * one. agy replays a loaded session's history as updates before it answers, so nothing it sends
 * before the answer reaches `handlers`, and a permission request during the replay is refused.
 */
export async function openSession(daemon: AcpDaemon, cwd: string, session: TurnSession, handlers: acp.SessionHandlers): Promise<Opened> {
  if (session.kind === 'new') {
    const created = await daemon.call('session/new', { cwd, mcpServers: [] }, SessionNewResponse, OPEN_MS);
    if (created.kind !== 'ok') return { kind: 'refused', error: callError('start a session', created) };
    const { sessionId, configOptions, _meta } = created.value;
    return { kind: 'opened', sessionId, isNew: true, options: configOptions ?? [], tier: _meta?.antigravity?.tier?.name ?? null, detach: daemon.attach(sessionId, handlers) };
  }
  if (!daemon.canLoad) return { kind: 'refused', error: { kind: 'session-lost' } };
  const { ref } = session;
  const replay = { done: false };
  const detach = daemon.attach(ref, {
    onUpdate: (update) => {
      if (replay.done) handlers.onUpdate(update);
    },
    onPermission: (request) => (replay.done ? handlers.onPermission(request) : Promise.resolve(CANCELLED)),
    onRefused: handlers.onRefused,
    replaying: () => !replay.done,
  });
  const loaded = await daemon.call('session/load', { sessionId: ref, cwd, mcpServers: [] }, SessionLoadResponse, OPEN_MS);
  if (loaded.kind !== 'ok') {
    detach();
    return { kind: 'refused', error: loaded.kind === 'error' && SESSION_GONE.test(loaded.message) ? { kind: 'session-lost' } : callError('reopen the session', loaded) };
  }
  replay.done = true;
  const { configOptions, _meta } = loaded.value;
  return { kind: 'opened', sessionId: ref, isNew: false, options: configOptions ?? [], tier: _meta?.antigravity?.tier?.name ?? null, detach };
}

export type Configured = { readonly kind: 'configured'; readonly model: string | null } | { readonly kind: 'refused'; readonly error: ProviderError };

/**
 * Puts the session in agy's Default mode (ask before edits and commands) and applies the picked
 * model and its choices, checking each against agy's answer. The session is refused unless agy
 * reports Default mode at the end. Teaches `catalog` each model's settings as agy reports them.
 */
export async function configureSession(
  daemon: AcpDaemon,
  sessionId: string,
  opened: readonly acp.ConfigOption[],
  setup: {
    readonly selection: ModelSelection;
    readonly catalog: ModelCatalog;
    readonly fresh: boolean;
    /** Called just before agy is asked for Default mode, so only what it says afterwards counts. */
    readonly forgetMode: () => void;
  },
): Promise<Configured> {
  const { selection, catalog } = setup;
  let options = opened;
  const set = async (configId: string, value: string): Promise<ProviderError | null> => {
    const reply = await daemon.call('session/set_config_option', { sessionId, configId, value }, acp.SetConfigResponse, SET_MS);
    if (reply.kind !== 'ok') return callError(`change its ${configId} setting`, reply);
    options = reply.value.configOptions;
    return null;
  };
  catalog.observe(options, setup.fresh);
  if (acp.selectOf(options, 'mode')?.current !== ASKING_MODE) {
    setup.forgetMode();
    const failed = await set('mode', ASKING_MODE);
    if (failed !== null) return { kind: 'refused', error: failed };
  }
  if (selection.kind === 'model') {
    if (acp.selectOf(options, MODEL)?.current !== selection.id) {
      const failed = await set(MODEL, selection.id);
      if (failed !== null) return { kind: 'refused', error: failed.kind === 'other' ? { kind: 'invalid-model' } : failed };
      if (acp.selectOf(options, MODEL)?.current !== selection.id) return { kind: 'refused', error: { kind: 'invalid-model' } };
      catalog.observe(options, false);
    }
    const thought = selection.choices[THOUGHT];
    const offered = acp.selectOf(options, THOUGHT);
    if (thought !== undefined && offered !== null && offered.current !== thought && offered.values.some((entry) => entry.value === thought)) {
      const failed = await set(THOUGHT, thought);
      if (failed !== null) return { kind: 'refused', error: failed };
      if (acp.selectOf(options, THOUGHT)?.current !== thought) return { kind: 'refused', error: { kind: 'other', message: `Antigravity did not take the thinking level "${thought}".` } };
    }
  }
  if (acp.selectOf(options, 'mode')?.current !== ASKING_MODE) {
    return { kind: 'refused', error: { kind: 'access-not-supported', reason: 'Antigravity would not run this chat in its Default mode, which asks before every edit and command.' } };
  }
  return { kind: 'configured', model: acp.selectOf(options, MODEL)?.current ?? null };
}

/** Frees the session in the daemon; agy keeps it on disk. */
export function closeSession(daemon: AcpDaemon, sessionId: string): void {
  if (!daemon.canClose || !daemon.alive()) return;
  daemon.call('session/close', { sessionId }, acp.Ignored, CLOSE_MS).catch((error: unknown) => {
    console.error('provider-antigravity: could not close a session', error);
  });
}

/** An error agy answered a request with, as the contract's error. */
export function vendorError(code: number, message: string): ProviderError {
  if (code === AUTH_REQUIRED || SIGNED_OUT.test(message)) return { kind: 'signed-out' };
  if (/quota|rate.?limit|resource.?exhausted|too many requests|\b429\b/i.test(message)) return { kind: 'rate-limited', resetsAt: null, windowId: null };
  if (/context (window|length)|too long|maximum context|token limit/i.test(message)) return { kind: 'context-too-long' };
  if (/model\b.*\b(not found|unavailable|unknown|not supported|invalid)/i.test(message)) return { kind: 'invalid-model' };
  if (/overloaded|unavailable|\b503\b|timed? ?out|network|connection/i.test(message)) return { kind: 'transient', retryAfterMs: null };
  return { kind: 'other', message: `Antigravity: ${message}` };
}

/** Why a call failed, as the contract's error: agy's own error, or `transient` when the daemon gave no usable answer. */
function callError(what: string, call: Exclude<acp.Call<unknown>, { readonly kind: 'ok' }>): ProviderError {
  if (call.kind === 'unanswered') return { kind: 'transient', retryAfterMs: null };
  const error = vendorError(call.code, call.message);
  return error.kind === 'other' ? { kind: 'other', message: `Antigravity could not ${what}: ${call.message}` } : error;
}
