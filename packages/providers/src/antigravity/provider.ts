import { defineProvider, type PluginRuntime, type ProviderError, type ProviderInfo, type ProviderPlugin, type RouteInfo } from '@morrowbot/plugin-sdk';
import { startDaemon } from './daemon.ts';
import { platformReason, readyInfo } from './info.ts';
import { createModelCatalog } from './models.ts';
import { parseSettings, type Settings } from './settings.ts';
import { runTurn, type Live } from './turn.ts';
import { readVersion, SUPPORTED_TEXT } from './version.ts';
import { checkWorkspace } from './workspace.ts';

interface Started {
  readonly settings: Settings;
  /** Where the daemon and probes run: the provider's own data folder. */
  readonly probeCwd: string;
  /** MorrowBot's own Antigravity folder, kept apart from the user's `~/.gemini`. */
  readonly geminiDir: string;
}

/** The built-in Antigravity provider. All its state lives here, so a restart starts clean. */
export function createAntigravityProvider(runtime: PluginRuntime): ProviderPlugin {
  let started: Started | undefined;
  let live: Live | undefined;
  let starting: Promise<Live | string> | undefined;
  let breach: string | null = null;

  const current = (): Started => {
    if (started === undefined) throw new Error('provider-antigravity has not been started yet');
    return started;
  };

  /** The one running daemon, started here if there is none: never during a turn. */
  const ensureDaemon = async (): Promise<Live | string> => {
    if (live?.daemon.alive() === true) return live;
    const { settings, probeCwd, geminiDir } = current();
    starting ??= startDaemon(runtime.jsonRpcProcess, settings.cliPath, probeCwd, geminiDir)
      .then((result) => {
        if (result.kind === 'failed') return result.reason;
        const fresh: Live = { daemon: result.daemon, catalog: createModelCatalog(), tier: null, signedOut: false };
        live = fresh;
        fresh.daemon.exited
          .then(() => {
            if (live === fresh) live = undefined;
          })
          .catch((error: unknown) => {
            console.error('provider-antigravity: the daemon exit could not be recorded', error);
          });
        return fresh;
      })
      .finally(() => {
        starting = undefined;
      });
    return starting;
  };

  const providerInfo = async (): Promise<ProviderInfo> => {
    const { settings, probeCwd, geminiDir } = current();
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
    const running = await ensureDaemon();
    if (typeof running === 'string') return { kind: 'error', message: running };
    if (running.signedOut) return { kind: 'signed-out', signIn: { kind: 'run-in-terminal', argv: [executable.path, 'acp', '--gemini-dir', geminiDir, '--login'] } };
    return readyInfo(version, { tier: running.tier, models: running.catalog.models(), breach }, runtime.platform);
  };

  const routeInfo = (): RouteInfo =>
    live?.daemon.alive() === true ? { kind: 'known', accountKey: '', routeKey: '' } : { kind: 'failed', reason: 'Antigravity is not running. Recheck the provider.' };

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
      started = { settings: parseSettings(config), probeCwd: dataDir, geminiDir: `${dataDir}/gemini` };
    },
    health: async () => {
      const { cliPath } = current().settings;
      return (await runtime.statExecutable(cliPath)).kind === 'found'
        ? { kind: 'ok' }
        : { kind: 'degraded', detail: `Antigravity CLI not found ("${cliPath}"). Install Antigravity, or set "Antigravity CLI path".` };
    },
    shutdown: async () => {
      const pending = starting;
      if (pending !== undefined) await pending;
      await live?.daemon.close();
    },
    providerInfo: () => providerInfo(),
    usage: () => ({ kind: 'unavailable', observedAt: new Date().toISOString(), accountKey: '', reason: 'unsupported' }),
    routeInfo: () => routeInfo(),
    turn: (context) =>
      runTurn(context, {
        live: () => live,
        checkCli,
        checkWorkspace: (cwd, signal) => checkWorkspace(runtime.runCommand, cwd, signal),
        platformReason: platformReason(runtime.platform),
        breach: () => breach,
        onBreach: (reason) => {
          breach ??= reason;
          const daemon = live?.daemon;
          setTimeout(() => {
            daemon?.close().catch((error: unknown) => {
              console.error('provider-antigravity: could not end the daemon after agy broke the read-only rules', error);
            });
          }, 0);
        },
        home: runtime.env.HOME ?? null,
      }),
  });
}

function missingRuntime(): ProviderInfo {
  return { kind: 'missing-runtime', install: 'Install Antigravity and its agy CLI, or set "Antigravity CLI path".' };
}
