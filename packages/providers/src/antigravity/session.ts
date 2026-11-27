import type { ModelSelection, ProviderError, TurnSession } from '@morrowbot/plugin-sdk';
import type { AcpDaemon, Call, SessionHandlers } from './daemon.ts';
import { MODEL, THOUGHT, type ModelCatalog } from './models.ts';
import { Ignored, selectOf, SessionLoadResponse, SessionNewResponse, SetConfigResponse, type ConfigOption } from './protocol.ts';
import { ASKING_MODE } from './session-stream.ts';

const OPEN_MS = 60_000;
const SET_MS = 15_000;
const CLOSE_MS = 5_000;
const SESSION_GONE = /not found|no such|does not exist|unknown session/i;
export const SIGNED_OUT = /not logged in|log ?in|sign ?in|authenticat|unauthori[sz]ed/i;
/** ACP's "authentication required" error code. */
const AUTH_REQUIRED = -32000;

export type Opened =
  | {
      readonly kind: 'opened';
      readonly sessionId: string;
      readonly isNew: boolean;
      readonly options: readonly ConfigOption[];
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
export async function openSession(daemon: AcpDaemon, cwd: string, session: TurnSession, handlers: SessionHandlers): Promise<Opened> {
  if (session.kind === 'new') {
    const created = await daemon.call('session/new', { cwd, mcpServers: [] }, SessionNewResponse, OPEN_MS);
    if (created.kind !== 'ok') return { kind: 'refused', error: openError('start a session', created) };
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
    onPermission: (request) => (replay.done ? handlers.onPermission(request) : Promise.reject(new Error('MorrowBot does not approve anything while a chat reloads.'))),
    onRefused: handlers.onRefused,
  });
  const loaded = await daemon.call('session/load', { sessionId: ref, cwd, mcpServers: [] }, SessionLoadResponse, OPEN_MS);
  if (loaded.kind !== 'ok') {
    detach();
    return { kind: 'refused', error: loaded.kind === 'error' && SESSION_GONE.test(loaded.message) ? { kind: 'session-lost' } : openError('reopen the session', loaded) };
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
export async function configureSession(daemon: AcpDaemon, sessionId: string, opened: readonly ConfigOption[], selection: ModelSelection, catalog: ModelCatalog, fresh: boolean): Promise<Configured> {
  let options = opened;
  const set = async (configId: string, value: string): Promise<Call<SetConfigResponse>> => {
    const reply = await daemon.call('session/set_config_option', { sessionId, configId, value }, SetConfigResponse, SET_MS);
    if (reply.kind === 'ok') options = reply.value.configOptions;
    return reply;
  };
  catalog.observe(options, fresh);
  if (selectOf(options, 'mode')?.current !== ASKING_MODE) await set('mode', ASKING_MODE);
  if (selection.kind === 'model') {
    if (selectOf(options, MODEL)?.current !== selection.id) {
      const moved = await set(MODEL, selection.id);
      if (moved.kind !== 'ok' || selectOf(options, MODEL)?.current !== selection.id) return { kind: 'refused', error: { kind: 'invalid-model' } };
      catalog.observe(options, false);
    }
    const thought = selection.choices[THOUGHT];
    const offered = selectOf(options, THOUGHT);
    if (thought !== undefined && offered !== null && offered.current !== thought && offered.values.some((entry) => entry.value === thought)) {
      const chosen = await set(THOUGHT, thought);
      if (chosen.kind !== 'ok') return { kind: 'refused', error: { kind: 'other', message: `Antigravity did not take the thinking level "${thought}"` } };
    }
  }
  if (selectOf(options, 'mode')?.current !== ASKING_MODE) {
    return { kind: 'refused', error: { kind: 'access-not-supported', reason: 'Antigravity would not run this chat in its Default mode, which asks before every edit and command.' } };
  }
  return { kind: 'configured', model: selectOf(options, MODEL)?.current ?? null };
}

/** Frees the session in the daemon; agy keeps it on disk. */
export function closeSession(daemon: AcpDaemon, sessionId: string): void {
  if (!daemon.canClose || !daemon.alive()) return;
  daemon.call('session/close', { sessionId }, Ignored, CLOSE_MS).catch((error: unknown) => {
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

function openError(what: string, call: { readonly kind: 'error'; readonly code: number; readonly message: string } | { readonly kind: 'unanswered'; readonly reason: string }): ProviderError {
  if (call.kind === 'error') {
    const error = vendorError(call.code, call.message);
    return error.kind === 'other' ? { kind: 'other', message: `Antigravity could not ${what}: ${call.message}` } : error;
  }
  return { kind: 'other', message: call.reason };
}
