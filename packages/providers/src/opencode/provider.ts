import { acp, defineProvider, type PluginRuntime, type ProviderError, type ProviderInfo, type ProviderPlugin, type RouteInfo } from '@morrowbot/plugin-sdk';
import { agentEnv } from './config.ts';
import { platformReason, readyInfo } from './info.ts';
import { checkManagedConfig } from './managed.ts';
import { createModelCatalog } from './models.ts';
import { parseSettings, type Settings } from './settings.ts';
import { runTurn, type Live } from './turn.ts';
import { readVersion, SUPPORTED_TEXT } from './version.ts';

interface Started {
  readonly settings: Settings;
  /** Where the daemon and probes run: the provider's own data folder. */
  readonly probeCwd: string;
  /** MorrowBot's own opencode folders, kept apart from the user's. */
  readonly agentDir: string;
}

/** The built-in OpenCode provider. All its state lives here, so a restart starts clean. */
export function createOpenCodeProvider(runtime: PluginRuntime): ProviderPlugin {
  let started: Started | undefined;
  let live: Live | undefined;
  let starting: Promise<Live | string> | undefined;
  let breach: string | null = null;
  /** Settles, once, when opencode breaks the read-only rules: every turn on the daemon stops then. */
  const fenced = Promise.withResolvers<string>();
  const home = runtime.env.HOME ?? null;
  const onBreach = (found: acp.Breach, version: string | null): void => {
    if (breach !== null) return;
    breach = breachReason(found, version);
    fenced.resolve(breach);
  };

  const current = (): Started => {
    if (started === undefined) throw new Error('provider-opencode has not been started yet');
    return started;
  };

  const checkManaged = async (): Promise<string | null> => {
    const managed = await checkManagedConfig('/', runtime.platform);
    return managed.kind === 'clear' ? null : managed.reason;
  };

  /** The one running daemon, started here if there is none: never during a turn. */
  const ensureDaemon = async (cliPath: string): Promise<Live | string> => {
    if (live?.client.alive() === true) return live;
    const { probeCwd, agentDir } = current();
    starting ??= acp
      .startAcpClient(runtime.jsonRpcProcess, cliPath, { name: 'OpenCode', args: ['acp'], cwd: probeCwd, env: agentEnv(agentDir), home, onBreach })
      .then((result) => {
        if (result.kind === 'failed') return result.reason;
        const fresh: Live = { client: result.client, catalog: createModelCatalog() };
        live = fresh;
        fresh.client.exited
          .then(() => {
            if (live === fresh) live = undefined;
          })
          .catch((error: unknown) => {
            console.error('provider-opencode: the daemon exit could not be recorded', error);
          });
        return fresh;
      })
      .finally(() => {
        starting = undefined;
      });
    return starting;
  };

  const providerInfo = async (): Promise<ProviderInfo> => {
    const { settings, probeCwd } = current();
    const executable = await runtime.statExecutable(settings.cliPath);
    if (executable.kind === 'missing') return missingRuntime();
    const version = await readVersion(runtime, settings.cliPath, probeCwd);
    switch (version.kind) {
      case 'missing':
        return missingRuntime();
      case 'below':
        return { kind: 'outdated', found: version.version, supported: SUPPORTED_TEXT };
      case 'unreadable':
        return { kind: 'error', message: version.reason };
      case 'supported':
      case 'above':
        break;
    }
    const held = breach ?? (await checkManaged());
    if (held !== null || version.kind === 'above' || platformReason(runtime.platform) !== null) return readyInfo(version, { models: live?.catalog.models() ?? null, held }, runtime.platform);
    const running = await ensureDaemon(executable.path);
    if (typeof running === 'string') return { kind: 'error', message: running };
    return readyInfo(version, { models: running.catalog.models(), held: breach }, runtime.platform);
  };

  const routeInfo = (): RouteInfo =>
    live?.client.alive() === true ? { kind: 'known', accountKey: '', routeKey: '' } : { kind: 'failed', reason: 'OpenCode is not running. Recheck the provider.' };

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
      started = { settings: parseSettings(config), probeCwd: dataDir, agentDir: `${dataDir}/opencode` };
    },
    health: async () => {
      const { cliPath } = current().settings;
      return (await runtime.statExecutable(cliPath)).kind === 'found'
        ? { kind: 'ok' }
        : { kind: 'degraded', detail: `OpenCode CLI not found ("${cliPath}"). Install opencode, or set "OpenCode CLI path".` };
    },
    shutdown: async () => {
      const pending = starting;
      if (pending !== undefined) await pending;
      await live?.client.close();
    },
    providerInfo: () => providerInfo(),
    usage: () => ({ kind: 'unavailable', observedAt: new Date().toISOString(), accountKey: '', reason: 'unsupported' }),
    routeInfo: () => routeInfo(),
    turn: (context) =>
      runTurn(context, {
        live: () => live,
        checkCli,
        checkManaged,
        platformReason: platformReason(runtime.platform),
        breach: () => breach,
        fenced: fenced.promise,
        home,
      }),
  });
}

function missingRuntime(): ProviderInfo {
  return { kind: 'missing-runtime', install: 'Install opencode 2.4 from https://opencode.ai, or set "OpenCode CLI path".' };
}

/** What the user is told, and the profile is withheld with, after `breach`. */
function breachReason(breach: acp.Breach, version: string | null): string {
  const opencode = version === null ? 'opencode' : `opencode ${version}`;
  const what = breach.kind === 'unasked-change' ? `ran "${breach.tool}" without asking` : `left its build mode for "${breach.mode}"`;
  return `OpenCode (${opencode}) ${what}. MorrowBot ended it and offers no OpenCode turns until the provider restarts.`;
}
