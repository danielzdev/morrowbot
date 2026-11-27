import {
  defineProvider,
  type PluginRuntime,
  type ProviderError,
  type ProviderInfo,
  type ProviderModel,
  type ProviderPlugin,
  type RouteInfo,
  type UsageResult,
} from '@morrowbot/plugin-sdk';
import { startDaemon, type CodexDaemon } from './daemon.ts';
import { modelsOf, platformReason, readyInfo } from './info.ts';
import { ModelListResponse } from './protocol.ts';
import { resolve, type Resolution } from './route.ts';
import { parseSettings, type Settings } from './settings.ts';
import { runTurn } from './turn.ts';
import { createUsageSnapshot } from './usage-snapshot.ts';
import { readQuota } from './usage.ts';
import { readVersion, SUPPORTED_TEXT } from './version.ts';

/** How long `provider-info {refresh:false}` may show an earlier answer. Turns never use it. */
const INFO_DISPLAY_MS = 60_000;
const MODELS_MS = 15_000;

interface Started {
  readonly settings: Settings;
  /** Where the daemon and probes run: the plugin's own data folder. */
  readonly probeCwd: string;
}

/** What this process's own `provider-info` last saw, for `usage`. */
type Seen =
  | { readonly kind: 'nothing' }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'stateless' }
  | { readonly kind: 'unidentified' }
  | { readonly kind: 'account'; readonly accountKey: string };

export function createCodexProvider(runtime: PluginRuntime): ProviderPlugin {
  let started: Started | undefined;
  let daemon: CodexDaemon | undefined;
  let starting: Promise<CodexDaemon | string> | undefined;
  let generation = 0;
  let infoCache: { readonly at: number; readonly generation: number; readonly info: ProviderInfo } | undefined;
  let models: { readonly generation: number; readonly list: readonly ProviderModel[] } | undefined;
  let seen: Seen = { kind: 'nothing' };
  let calls = 0;
  const snapshot = createUsageSnapshot();
  /** Another account's windows are dropped as soon as `provider-info` sees a different one, or none. */
  const see = (next: Seen): void => {
    if (next.kind !== 'account' || seen.kind !== 'account' || next.accountKey !== seen.accountKey) snapshot.clear();
    seen = next;
  };

  const current = (): Started => {
    if (started === undefined) throw new Error('provider-openai has not been started yet');
    return started;
  };

  /** The one running daemon, started here if there is none: never during a turn. */
  const ensureDaemon = async (): Promise<CodexDaemon | string> => {
    if (daemon?.alive() === true) return daemon;
    const { settings, probeCwd } = current();
    starting ??= startDaemon(runtime.jsonRpcProcess, settings.cliPath, probeCwd, ++generation)
      .then((result) => {
        if (result.kind === 'failed') return result.reason;
        const fresh = result.daemon;
        daemon = fresh;
        void fresh.exited.then(() => {
          if (daemon === fresh) daemon = undefined;
        });
        return fresh;
      })
      .finally(() => {
        starting = undefined;
      });
    return starting;
  };

  const listModels = async (target: CodexDaemon): Promise<readonly ProviderModel[]> => {
    if (models?.generation === target.generation) return models.list;
    const listed = await target.call('model/list', { limit: 200, includeHidden: false }, ModelListResponse, MODELS_MS);
    if (listed.kind !== 'ok') return [];
    const list = modelsOf(listed.value.data);
    models = { generation: target.generation, list };
    return list;
  };

  const providerInfo = async (refresh: boolean): Promise<ProviderInfo> => {
    const cached = infoCache;
    if (!refresh && cached !== undefined && daemon?.alive() === true && cached.generation === daemon.generation && Date.now() - cached.at <= INFO_DISPLAY_MS) {
      return cached.info;
    }
    const call = ++calls;
    const seeIfNewest = (next: Seen): void => {
      if (call === calls) see(next);
    };
    const notReady = (info: ProviderInfo): ProviderInfo => {
      seeIfNewest({ kind: 'nothing' });
      if (call === calls) infoCache = undefined;
      return info;
    };
    const { settings, probeCwd } = current();
    const executable = await runtime.statExecutable(settings.cliPath);
    if (executable.kind === 'missing') return notReady(missingRuntime());
    const version = await readVersion(runtime, settings.cliPath, probeCwd);
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
    const running = await ensureDaemon();
    if (typeof running === 'string') return notReady({ kind: 'error', message: running });
    const resolution = await resolve(running, probeCwd);
    if (resolution.kind === 'signed-out') {
      seeIfNewest({ kind: 'signed-out' });
      if (call === calls) infoCache = undefined;
      const login = [executable.path, 'login'];
      const argv = running.codexHome === null ? login : ['env', `CODEX_HOME=${running.codexHome}`, ...login];
      return { kind: 'signed-out', signIn: { kind: 'run-in-terminal', argv } };
    }
    const info = readyInfo(version, resolution, await listModels(running), runtime.platform);
    seeIfNewest(seenOf(resolution));
    if (call === calls) infoCache = { at: Date.now(), generation: running.generation, info };
    return info;
  };

  const routeInfo = async (cwd: string): Promise<RouteInfo> => {
    if (daemon?.alive() !== true) return { kind: 'failed', reason: 'Codex is not running. Recheck the provider.' };
    const resolution = await resolve(daemon, cwd);
    switch (resolution.kind) {
      case 'failed':
        return { kind: 'failed', reason: resolution.reason };
      case 'signed-out':
        return { kind: 'failed', reason: 'Codex is signed out. Sign in, then Recheck.' };
      case 'resolved':
        return { kind: 'known', accountKey: resolution.accountKey, routeKey: resolution.routeKey };
    }
  };

  const usage = async (refresh: boolean): Promise<UsageResult> => {
    const observedAt = new Date().toISOString();
    const unavailable = (reason: Extract<UsageResult, { kind: 'unavailable' }>['reason'], accountKey = ''): UsageResult => ({
      kind: 'unavailable',
      observedAt,
      accountKey,
      reason,
    });
    switch (seen.kind) {
      case 'nothing':
      case 'unidentified':
        return unavailable('not-yet-observed');
      case 'signed-out':
        return unavailable('signed-out');
      case 'stateless':
        return unavailable('api-key-route');
      case 'account':
        break;
    }
    const { accountKey } = seen;
    if (refresh && daemon?.alive() === true) {
      const seenBefore = seen;
      const read = await readQuota(daemon, current().probeCwd);
      if (seen !== seenBefore) return unavailable('probe-failed');
      /** The read saw another account than provider-info did: forget both until provider-info looks again. */
      const moved = (next: Seen): void => {
        see(next);
        infoCache = undefined;
      };
      switch (read.kind) {
        case 'available':
          if (read.accountKey !== accountKey) {
            moved({ kind: 'nothing' });
            return unavailable('probe-failed');
          }
          snapshot.observe(accountKey, read.observedAt, read.windows);
          break;
        case 'failed':
          if (read.accountKey !== null && read.accountKey !== accountKey) {
            moved({ kind: 'nothing' });
            return unavailable('probe-failed');
          }
          return unavailable('probe-failed', accountKey);
        case 'api-key-route':
          moved({ kind: 'stateless' });
          return unavailable('api-key-route');
        case 'signed-out':
          moved({ kind: 'signed-out' });
          return unavailable('signed-out');
        case 'unidentified':
          moved({ kind: 'unidentified' });
          return unavailable('not-yet-observed');
      }
    } else if (refresh) {
      return unavailable('probe-failed', accountKey);
    }
    const kept = snapshot.read(accountKey);
    if (kept === null) return unavailable('not-yet-observed', accountKey);
    return { kind: 'available', observedAt: kept.observedAt, accountKey, windows: [...kept.windows] };
  };

  const checkCli = async (cwd: string): Promise<ProviderError | null> => {
    const version = await readVersion(runtime, current().settings.cliPath, cwd);
    switch (version.kind) {
      case 'supported':
        return null;
      case 'missing':
        return { kind: 'not-installed' };
      case 'below':
        return { kind: 'outdated' };
      case 'above':
      case 'unreadable':
        return { kind: 'access-not-supported', reason: version.reason };
    }
  };

  return defineProvider({
    init: ({ config, dataDir }) => {
      started = { settings: parseSettings(config), probeCwd: dataDir };
    },
    health: async () => {
      const { cliPath } = current().settings;
      return (await runtime.statExecutable(cliPath)).kind === 'found'
        ? { kind: 'ok' }
        : { kind: 'degraded', detail: `Codex CLI not found ("${cliPath}"). Install Codex, or set "Codex CLI path".` };
    },
    shutdown: async () => {
      const pending = starting;
      if (pending !== undefined) await pending;
      await daemon?.close();
    },
    providerInfo: ({ refresh }) => providerInfo(refresh),
    usage: ({ refresh }) => usage(refresh),
    routeInfo: ({ cwd }) => routeInfo(cwd),
    turn: (context) =>
      runTurn(context, {
        daemon: () => daemon,
        checkCli,
        platformReason: platformReason(runtime.platform),
        home: runtime.env.HOME ?? null,
        onUsage: (accountKey, observedAt, windows) => {
          if (seen.kind === 'account' && seen.accountKey === accountKey) snapshot.observe(accountKey, observedAt, windows);
        },
      }),
  });
}

function seenOf(resolution: Exclude<Resolution, { kind: 'signed-out' }>): Seen {
  if (resolution.kind === 'failed') return { kind: 'nothing' };
  switch (resolution.route.kind) {
    case 'subscription':
      return { kind: 'account', accountKey: resolution.accountKey };
    case 'unidentified':
      return { kind: 'unidentified' };
    case 'stateless':
      return { kind: 'stateless' };
  }
}

function missingRuntime(): ProviderInfo {
  return {
    kind: 'missing-runtime',
    install:
      'Install Codex (https://developers.openai.com/codex), or set "Codex CLI path". The ChatGPT app ships one at /Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex.',
  };
}
