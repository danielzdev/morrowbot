import { acp, type HostTools, type ModelSelection, type ProviderError } from '@morrowbot/plugin-sdk';
import { BUILD_MODE, FULL_MODE } from './config.ts';
import { MODEL, type ModelCatalog } from './models.ts';

const OPEN_MS = 60_000;
const SET_MS = 15_000;
const CLOSE_MS = 5_000;

export type Opened =
  | { readonly kind: 'opened'; readonly sessionId: string; readonly options: readonly acp.ConfigOption[]; readonly detach: () => void }
  | { readonly kind: 'refused'; readonly error: ProviderError };

/** Opens the turn's session: `session/new` in `cwd` with only Ori Kami's MCP server. Ori Kami never resumes an opencode session. */
export async function openSession(client: acp.AcpClient, cwd: string, tools: HostTools, handlers: acp.SessionHandlers): Promise<Opened> {
  const created = await client.call('session/new', { cwd, mcpServers: acp.hostMcpServers(client, tools) }, acp.SessionNewResponse, OPEN_MS);
  if (created.kind !== 'ok') return { kind: 'refused', error: callError('start a session', created) };
  const { sessionId, configOptions } = created.value;
  return { kind: 'opened', sessionId, options: configOptions ?? [], detach: client.attach(sessionId, handlers) };
}

export type Configured = { readonly kind: 'configured'; readonly model: string | null } | { readonly kind: 'refused'; readonly error: ProviderError };

export type OpenCodeAccess = 'read-only' | 'full';

/**
 * Checks or sets the session mode (`build` for read-only, `full` for full access) and applies the
 * picked model, checking each against opencode's answer. Teaches `catalog` the models opencode reports.
 */
export async function configureSession(
  client: acp.AcpClient,
  sessionId: string,
  opened: readonly acp.ConfigOption[],
  setup: {
    readonly access: OpenCodeAccess;
    readonly selection: ModelSelection;
    readonly catalog: ModelCatalog;
  },
): Promise<Configured> {
  const { access, selection, catalog } = setup;
  const targetMode = access === 'full' ? FULL_MODE : BUILD_MODE;
  catalog.observe(opened, true);
  let options = opened;
  if (access === 'full' && acp.selectOf(options, 'mode')?.current !== FULL_MODE) {
    const reply = await client.call('session/set_config_option', { sessionId, configId: 'mode', value: FULL_MODE }, acp.SetConfigResponse, SET_MS);
    if (reply.kind !== 'ok') return { kind: 'refused', error: callError('change its mode', reply) };
    options = reply.value.configOptions;
  }
  if (selection.kind === 'model' && acp.selectOf(options, MODEL)?.current !== selection.id) {
    const reply = await client.call('session/set_config_option', { sessionId, configId: MODEL, value: selection.id }, acp.SetConfigResponse, SET_MS);
    if (reply.kind !== 'ok') {
      const error = callError('change its model', reply);
      return { kind: 'refused', error: error.kind === 'other' ? { kind: 'invalid-model' } : error };
    }
    options = reply.value.configOptions;
    if (acp.selectOf(options, MODEL)?.current !== selection.id) return { kind: 'refused', error: { kind: 'invalid-model' } };
    catalog.observe(options, false);
  }
  if (acp.selectOf(options, 'mode')?.current !== targetMode) {
    const reason =
      access === 'full'
        ? 'OpenCode would not switch this chat to its full-access mode.'
        : "OpenCode would not run this chat in its build mode, which Ori Kami's read-only permissions hold.";
    return { kind: 'refused', error: { kind: 'access-not-supported', reason } };
  }
  return { kind: 'configured', model: acp.selectOf(options, MODEL)?.current ?? null };
}

/** Frees the session in the daemon; opencode keeps it in its own (Ori Kami's) data folder. */
export function closeSession(client: acp.AcpClient, sessionId: string): void {
  if (!client.canClose || !client.alive()) return;
  client.call('session/close', { sessionId }, acp.Ignored, CLOSE_MS).catch((error: unknown) => {
    console.error('provider-opencode: could not close a session', error);
  });
}

/** An error opencode answered a request with, as the contract's error. */
export function vendorError(message: string): ProviderError {
  if (/quota|usage limit|rate.?limit|resource.?exhausted|too many requests|\b429\b/i.test(message)) return { kind: 'rate-limited', resetsAt: null, windowId: null };
  if (/context (window|length)|too long|maximum context|token limit/i.test(message)) return { kind: 'context-too-long' };
  if (/model\b.*\b(not found|unavailable|unknown|not supported|invalid)/i.test(message)) return { kind: 'invalid-model' };
  if (/overloaded|unavailable|\b50[23]\b|timed? ?out|network|connection/i.test(message)) return { kind: 'transient', retryAfterMs: null };
  return { kind: 'other', message: `OpenCode: ${message}` };
}

/** Why a call failed, as the contract's error: opencode's own error, or `transient` when it gave no usable answer. */
function callError(what: string, call: Exclude<acp.Call<unknown>, { readonly kind: 'ok' }>): ProviderError {
  if (call.kind === 'unanswered') return { kind: 'transient', retryAfterMs: null };
  const error = vendorError(call.message);
  return error.kind === 'other' ? { kind: 'other', message: `OpenCode could not ${what}: ${call.message}` } : error;
}
