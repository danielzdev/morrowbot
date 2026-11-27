import {
  defineProvider,
  statExecutable,
  type ProviderInfo,
  type ProviderPlugin,
  type RouteInfo,
  type UsageResult,
} from '@morrowbot/plugin-sdk';
import { readAuth, type Auth } from './auth.ts';
import { readyInfo } from './info.ts';
import { checkManagedPolicy } from './policy.ts';
import { parseSettings, type Settings } from './settings.ts';
import { runTurn } from './turn.ts';
import { createUsageSnapshot } from './usage.ts';
import { readVersion, SUPPORTED_TEXT } from './version.ts';

/** How long `provider-info {refresh:false}` may show an earlier `auth status`. Turns never use it. */
const AUTH_DISPLAY_MS = 60_000;

interface Started {
  readonly settings: Settings;
  /** Where probes run: the plugin's own data folder. */
  readonly probeCwd: string;
}

/** What this process's own `provider-info` last saw, for `usage`. */
type Seen = { readonly kind: 'nothing' } | { readonly kind: 'signed-out' } | { readonly kind: 'account'; readonly accountKey: string };

export function createClaudeProvider(): ProviderPlugin {
  let started: Started | undefined;
  let authCache: { readonly at: number; readonly cliPath: string; readonly auth: Auth } | undefined;
  let seen: Seen = { kind: 'nothing' };
  const snapshot = createUsageSnapshot();
  /** Every other account's windows are dropped as soon as `provider-info` sees a different one, or none. */
  const see = (next: Seen): void => {
    if (next.kind !== 'account' || seen.kind !== 'account' || next.accountKey !== seen.accountKey) snapshot.clear();
    seen = next;
  };

  const current = (): Started => {
    if (started === undefined) throw new Error('provider-claude has not been started yet');
    return started;
  };

  const displayAuth = async (refresh: boolean): Promise<Auth> => {
    const { settings, probeCwd } = current();
    const now = Date.now();
    if (!refresh && authCache?.cliPath === settings.cliPath && now - authCache.at <= AUTH_DISPLAY_MS) return authCache.auth;
    const auth = await readAuth(settings.cliPath, probeCwd);
    authCache = { at: now, cliPath: settings.cliPath, auth };
    return auth;
  };

  /** An answer with no validated account: usage seen before it is no longer shown. */
  const notReady = (info: ProviderInfo): ProviderInfo => {
    see({ kind: 'nothing' });
    return info;
  };

  const providerInfo = async (refresh: boolean): Promise<ProviderInfo> => {
    const { settings, probeCwd } = current();
    const { cliPath } = settings;
    if ((await statExecutable(cliPath)).kind === 'missing') return notReady(missingRuntime());
    const version = await readVersion(cliPath, probeCwd);
    switch (version.kind) {
      case 'missing':
        return notReady(missingRuntime());
      case 'below':
        return notReady({ kind: 'outdated', found: version.version, supported: SUPPORTED_TEXT });
      case 'unreadable':
        return notReady({ kind: 'error', message: version.reason });
      case 'supported':
      case 'above':
        break;
    }
    const policy = await checkManagedPolicy();
    if (policy.kind === 'withheld') {
      see({ kind: 'nothing' });
      return readyInfo(version, policy, null, process.platform);
    }
    const auth = await displayAuth(refresh);
    switch (auth.kind) {
      case 'signed-out':
        see({ kind: 'signed-out' });
        return { kind: 'signed-out', signIn: { kind: 'run-in-terminal', argv: [cliPath, 'auth', 'login'] } };
      case 'not-installed':
        return notReady(missingRuntime());
      case 'failed':
        return notReady({ kind: 'error', message: auth.message });
      case 'personal':
      case 'withheld':
        see({ kind: 'account', accountKey: auth.accountKey });
        return readyInfo(version, policy, auth, process.platform);
    }
  };

  const routeInfo = async (cwd: string): Promise<RouteInfo> => {
    const policy = await checkManagedPolicy();
    if (policy.kind === 'withheld') return { kind: 'failed', reason: policy.reason };
    const auth = await readAuth(current().settings.cliPath, cwd);
    switch (auth.kind) {
      case 'personal':
      case 'withheld':
        return { kind: 'known', accountKey: auth.accountKey, routeKey: '' };
      case 'signed-out':
        return { kind: 'known', accountKey: '', routeKey: '' };
      case 'not-installed':
        return { kind: 'failed', reason: 'Claude Code CLI not found' };
      case 'failed':
        return { kind: 'failed', reason: auth.message };
    }
  };

  const usage = (): UsageResult => {
    const observedAt = new Date().toISOString();
    switch (seen.kind) {
      case 'signed-out':
        return { kind: 'unavailable', observedAt, accountKey: '', reason: 'signed-out' };
      case 'nothing':
        return { kind: 'unavailable', observedAt, accountKey: '', reason: 'not-yet-observed' };
      case 'account': {
        const observed = snapshot.read(seen.accountKey);
        if (observed === null) return { kind: 'unavailable', observedAt, accountKey: seen.accountKey, reason: 'not-yet-observed' };
        return { kind: 'available', observedAt: observed.observedAt, accountKey: seen.accountKey, windows: [...observed.windows] };
      }
    }
  };

  return defineProvider({
    init: ({ config, dataDir }) => {
      started = { settings: parseSettings(config), probeCwd: dataDir };
    },
    health: async () => {
      const { cliPath } = current().settings;
      return (await statExecutable(cliPath)).kind === 'found'
        ? { kind: 'ok' }
        : { kind: 'degraded', detail: `Claude Code CLI not found ("${cliPath}"). Install Claude Code, or set "Claude Code CLI path".` };
    },
    providerInfo: ({ refresh }) => providerInfo(refresh),
    usage,
    routeInfo: ({ cwd }) => routeInfo(cwd),
    turn: (context) =>
      runTurn(context, {
        cliPath: current().settings.cliPath,
        home: process.env.HOME ?? null,
        onUsage: (accountKey, observedAt, windows) => {
          if (seen.kind === 'account' && seen.accountKey === accountKey) snapshot.observe(accountKey, observedAt, windows);
        },
      }),
  });
}

function missingRuntime(): ProviderInfo {
  return { kind: 'missing-runtime', install: 'Install Claude Code (https://docs.claude.com/claude-code), or set "Claude Code CLI path".' };
}
