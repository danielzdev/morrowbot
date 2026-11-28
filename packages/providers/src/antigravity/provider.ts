import { acp, defineProvider, type PluginRuntime, type ProviderError, type ProviderInfo, type ProviderPlugin, type RouteInfo } from '@morrowbot/plugin-sdk';
import { startDaemon } from './daemon.ts';
import { platformReason, readyInfo } from './info.ts';
import { createModelCatalog } from './models.ts';
import { probeSession } from './probe.ts';
import { parseSettings, type Settings } from './settings.ts';
import { runTurn, type Live } from './turn.ts';
import { readVersion, SUPPORTED_TEXT } from './version.ts';
import { checkWorkspace } from './workspace.ts';

interface Started {
  readonly settings: Settings;
  /** Where the daemon and probes run: the provider's own data folder. */
  readonly probeCwd: string;
  /** Ori Kami's own Antigravity folder, kept apart from the user's `~/.gemini`. */
  readonly geminiDir: string;
}

/** The built-in Antigravity provider. All its state lives here, so a restart starts clean. */
export function createAntigravityProvider(runtime: PluginRuntime): ProviderPlugin {
  let started: Started | undefined;
  let live: Live | undefined;
  let starting: Promise<Live | string> | undefined;
  /** The probe running on each daemon, shared by concurrent provider-info calls. */
  const probing = new WeakMap<Live, Promise<void>>();
  const fence = acp.createFence();
  const onBreach = (reason: string): void => {
    fence.trip(reason);
  };

  const current = (): Started => {
    if (started === undefined) throw new Error('provider-antigravity has not been started yet');
    return started;
  };

  /** The one running daemon, started here if there is none: never during a turn. */
  const ensureDaemon = async (): Promise<Live | string> => {
    if (live?.daemon.alive() === true) return live;
    const { settings, probeCwd, geminiDir } = current();
    starting ??= startDaemon(runtime.jsonRpcProcess, { cliPath: settings.cliPath, cwd: probeCwd, geminiDir, home: runtime.env.HOME ?? null, onBreach })
      .then((result) => {
        if (result.kind === 'failed') return result.reason;
        const fresh: Live = { daemon: result.client, catalog: createModelCatalog(), tier: null, signedOut: false, probed: false };
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

  /**
   * Opens one probe session on `running`, shared by concurrent callers, until every model was tried,
   * and again while the user is signed out (so signing in is seen), finishing by `deadline`. Skipped
   * in a data folder agy would load customizations from, or with too little time left.
   */
  const discover = async (running: Live, probeCwd: string, deadline: number): Promise<void> => {
    const pending = probing.get(running);
    if (pending !== undefined) {
      await pending;
      return;
    }
    if ((running.probed && !running.signedOut) || deadline - Date.now() < MIN_PROBE_MS) return;
    const probe = checkWorkspace(runtime.runCommand, probeCwd, AbortSignal.timeout(Math.min(PROBE_CHECK_MS, deadline - Date.now())))
      .then((check) => (check.kind === 'clear' && deadline - Date.now() >= MIN_PROBE_MS ? probeSession(running, probeCwd, Math.min(deadline, Date.now() + PROBE_MS)) : undefined))
      .finally(() => {
        probing.delete(running);
      });
    probing.set(running, probe);
    await probe;
  };

  const providerInfo = async (): Promise<ProviderInfo> => {
    const deadline = Date.now() + INFO_BUDGET_MS;
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
    const breach = fence.reason();
    if (breach !== null) return readyInfo(version, { tier: live?.tier ?? null, models: live?.catalog.models() ?? null, breach }, runtime.platform);
    const running = await ensureDaemon();
    if (typeof running === 'string') return { kind: 'error', message: running };
    await discover(running, probeCwd, deadline);
    if (running.signedOut) return { kind: 'signed-out', signIn: { kind: 'run-in-terminal', argv: [executable.path, 'acp', '--gemini-dir', geminiDir, '--login'] } };
    return readyInfo(version, { tier: running.tier, models: running.catalog.models(), breach: fence.reason() }, runtime.platform);
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
        fence,
        home: runtime.env.HOME ?? null,
      }),
  });
}

/** Under the host's 30 s deadline for every provider-info after a worker's first (120 s). */
const INFO_BUDGET_MS = 27_000;
/** A probe takes about 1 s on agy 1.5.18; with less time left, provider-info answers models-later and the next call probes. */
const MIN_PROBE_MS = 2_000;
const PROBE_MS = 10_000;
const PROBE_CHECK_MS = 5_000;

function missingRuntime(): ProviderInfo {
  return { kind: 'missing-runtime', install: 'Install Antigravity and its agy CLI, or set "Antigravity CLI path".' };
}
