import type { CodexDaemon } from './daemon.ts';
import { ConfigReadResponse, GetAccountResponse, type CodexConfig } from './protocol.ts';

/** The pinned Codex defaults: a ChatGPT login sends inference here, workspace-bound. */
export const DEFAULT_CHATGPT_BASE_URL = 'https://chatgpt.com/backend-api/';
export const DEFAULT_CHATGPT_INFERENCE_URL = 'https://chatgpt.com/backend-api/codex';
const DEFAULT_API_INFERENCE_URL = 'https://api.openai.com/v1';
const BUILT_IN_PROVIDER = 'openai';

/** `account/read` can wait for workspace discovery over the network; route-info allows 15 s in all. */
export const RESOLVE_MS = 12_000;

/**
 * Whether turns on the current route spend the signed-in ChatGPT plan in a known workspace. Only that
 * route gets a non-empty accountKey, saved sessions and plan quota.
 */
export type Route =
  | { readonly kind: 'subscription'; readonly workspaceId: string }
  /** The subscription route, but Codex did not report the workspace or who is signed in. */
  | { readonly kind: 'unidentified'; readonly reason: string }
  /** A route that does not spend the ChatGPT plan: an API key, another provider or a custom endpoint. */
  | { readonly kind: 'stateless'; readonly reason: string };

/** One `account/read` + `config/read` snapshot, as every check of this plugin sees it. */
export type Resolution =
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'signed-out'; readonly routeKey: string }
  | {
      readonly kind: 'resolved';
      readonly accountKey: string;
      readonly routeKey: string;
      readonly route: Route;
      readonly accountLabel: string | null;
      /** The config this snapshot read, for the per-thread lockdown. */
      readonly config: CodexConfig;
    };

/** Reads the account and the effective config once, for a turn in `cwd`. Never sends inference. */
export async function resolve(daemon: CodexDaemon, cwd: string): Promise<Resolution> {
  const [account, config] = await Promise.all([
    daemon.call('account/read', { refreshToken: false }, GetAccountResponse, RESOLVE_MS),
    daemon.call('config/read', { includeLayers: false, cwd }, ConfigReadResponse, RESOLVE_MS),
  ]);
  if (account.kind !== 'ok') return { kind: 'failed', reason: describeFailure('read the account', account) };
  if (config.kind !== 'ok') return { kind: 'failed', reason: describeFailure('read its config', config) };
  return judgeRoute(account.value, config.value.config);
}

function describeFailure(what: string, call: { readonly kind: 'error'; readonly message: string } | { readonly kind: 'unanswered'; readonly reason: string }): string {
  return call.kind === 'error' ? `Codex could not ${what}: ${call.message}` : call.reason;
}

/** Turns one account + config snapshot into the account and route keys (§2 `routeKey`, §5 workspace identity). */
export async function judgeRoute(account: GetAccountResponse, config: CodexConfig): Promise<Resolution> {
  const providerId = config.model_provider ?? BUILT_IN_PROVIDER;
  const authClass = account.account?.type ?? 'none';
  const chatgptBase = normalizeUrl(config.chatgpt_base_url ?? DEFAULT_CHATGPT_BASE_URL);
  const bootstrap = normalizeUrl(bootstrapUrl(providerId, authClass, config));
  const defaultBase = chatgptBase === normalizeUrl(DEFAULT_CHATGPT_BASE_URL);
  const defaultInference =
    config.openai_base_url === null || config.openai_base_url === undefined || normalizeUrl(config.openai_base_url) === normalizeUrl(DEFAULT_CHATGPT_INFERENCE_URL);
  const workspaceBound = providerId === BUILT_IN_PROVIDER && authClass === 'chatgpt' && defaultBase && defaultInference;
  const routing = workspaceBound ? (account.workspaceRouting ?? null) : null;
  const effective = routing === null ? bootstrap : withOrigin(bootstrap, routing.backendOrigin);
  const routeKey = await sha256([
    'codex-route',
    providerId,
    authClass,
    bootstrap,
    chatgptBase,
    effective,
    routing?.accountRoutingOverride ?? '',
  ]);
  if (account.account === null) {
    if (account.requiresOpenaiAuth) return { kind: 'signed-out', routeKey };
    return { kind: 'resolved', accountKey: '', routeKey, route: { kind: 'stateless', reason: describeStateless(providerId, authClass) }, accountLabel: null, config };
  }
  const label = accountLabel(account.account);
  if (!workspaceBound) {
    return { kind: 'resolved', accountKey: '', routeKey, route: { kind: 'stateless', reason: describeStateless(providerId, authClass) }, accountLabel: label, config };
  }
  const identity = account.userId ?? account.account.email ?? null;
  if (routing === null || identity === null) {
    const reason =
      routing === null
        ? 'Codex has not found your ChatGPT workspace, so chats run without saved sessions and plan usage. Recheck to try again.'
        : 'Codex did not report who is signed in, so chats run without saved sessions and plan usage.';
    return { kind: 'resolved', accountKey: '', routeKey, route: { kind: 'unidentified', reason }, accountLabel: label, config };
  }
  const accountKey = await sha256(['codex-account', identity, routing.chatgptAccountId]);
  return { kind: 'resolved', accountKey, routeKey, route: { kind: 'subscription', workspaceId: routing.chatgptAccountId }, accountLabel: label, config };
}

function bootstrapUrl(providerId: string, authClass: string, config: CodexConfig): string {
  if (providerId === BUILT_IN_PROVIDER) {
    return config.openai_base_url ?? (authClass === 'chatgpt' ? DEFAULT_CHATGPT_INFERENCE_URL : DEFAULT_API_INFERENCE_URL);
  }
  return config.model_providers?.[providerId]?.base_url ?? '';
}

function describeStateless(providerId: string, authClass: string): string {
  if (providerId !== BUILT_IN_PROVIDER) return `Codex sends this chat to the "${providerId}" model provider, so it runs without saved sessions or plan usage.`;
  if (authClass !== 'chatgpt') return 'Codex is not signed in with ChatGPT, so chats run without saved sessions or plan usage.';
  return 'Codex sends inference to a custom endpoint, so chats run without saved sessions or plan usage.';
}

const PLANS: Readonly<Record<string, string>> = {
  free: 'ChatGPT Free',
  go: 'ChatGPT Go',
  plus: 'ChatGPT Plus',
  pro: 'ChatGPT Pro',
  prolite: 'ChatGPT Pro',
  promax: 'ChatGPT Pro',
  team: 'ChatGPT Business',
  business: 'ChatGPT Business',
  enterprise: 'ChatGPT Enterprise',
  edu: 'ChatGPT Edu',
};

function accountLabel(account: NonNullable<GetAccountResponse['account']>): string | null {
  switch (account.type) {
    case 'chatgpt': {
      const plan = PLANS[account.planType ?? ''] ?? 'ChatGPT';
      return account.workspaceName ? `${plan} (${account.workspaceName})` : plan;
    }
    case 'apiKey':
      return 'OpenAI API key';
    default:
      return null;
  }
}

/** Lowercase scheme and host, no trailing slash on the path; text that is not a URL is only trimmed. */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!URL.canParse(trimmed)) return trimmed;
  const parsed = new URL(trimmed);
  const pathname = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}`;
}

function withOrigin(url: string, origin: string): string {
  if (!URL.canParse(url) || !URL.canParse(origin)) return url;
  const parsed = new URL(url);
  return normalizeUrl(`${new URL(origin).origin}${parsed.pathname}${parsed.search}`);
}

async function sha256(parts: readonly string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
