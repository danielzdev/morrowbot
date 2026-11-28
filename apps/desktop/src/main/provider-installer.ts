import { spawn, type ChildProcess } from 'node:child_process';
import { lenient, PluginList } from '@morrowbot/contracts';
import { z } from 'zod';
import type {
  ProviderInstallCapabilities,
  ProviderInstallMode,
  ProviderInstallProgress,
  ProviderInstallResult,
} from '../renderer/bridge.ts';
import { checkSender, IpcRefusedError, proxyRequest, type HostTarget } from './ipc-proxy.ts';
import {
  capabilitiesOf,
  detectInstallTools,
  installerSearchPath,
  isBuiltinProviderId,
  planProviderInstall,
  type InstallTools,
} from './provider-install-plans.ts';
import type { FromRenderer } from './shell-actions.ts';

export { capabilitiesOf, detectInstallTools, installerSearchPath, planProviderInstall, type InstallTools, type ProviderInstallPlan } from './provider-install-plans.ts';

const ProviderId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const InstallMode = z.enum(['install', 'update']);
const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const KILL_GRACE_MS = 3_000;
const MAX_OUTPUT_BYTES = 8_192;
const PluginListReply = lenient(PluginList);

export interface InstallRequest {
  readonly providerId: string;
  readonly mode: ProviderInstallMode;
}

/** Checks an IPC `install-provider` message: only a provider id and mode, never a command or arguments. */
export function parseInstallRequest(options: FromRenderer): InstallRequest {
  checkSender(options.sender, options.rendererUrl);
  const parsed = z.strictObject({ providerId: ProviderId, mode: InstallMode }).safeParse(options.input);
  if (!parsed.success) throw new IpcRefusedError('Malformed provider install request');
  return parsed.data;
}

/** Checks an IPC `cancel-provider-install` message: only a provider id. */
export function parseCancelInstallRequest(options: FromRenderer): string {
  checkSender(options.sender, options.rendererUrl);
  const parsed = z.strictObject({ providerId: ProviderId }).safeParse(options.input);
  if (!parsed.success) throw new IpcRefusedError('Malformed cancel install request');
  return parsed.data.providerId;
}

export interface CommandRunOutcome {
  readonly kind: 'ok' | 'cancelled' | 'timeout' | 'failed';
  readonly exitCode: number | null;
  readonly output: string;
}

export type RunInstallCommand = (
  command: string,
  args: readonly string[],
  options: {
    readonly env: NodeJS.ProcessEnv;
    readonly signal: AbortSignal;
    readonly timeoutMs: number;
    readonly onLine: (line: string) => void;
  },
) => Promise<CommandRunOutcome>;

function appendBounded(current: string, chunk: string): string {
  const combined = current + chunk;
  return combined.length <= MAX_OUTPUT_BYTES ? combined : combined.slice(-MAX_OUTPUT_BYTES);
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals, detached: boolean): void {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    if (detached) process.kill(-pid, signal);
    else child.kill(signal);
  } catch {
    // Process already exited.
  }
}

/** Runs an allowlisted installer binary directly (`shell: false`) with timeout, cancellation and bounded output. */
export const spawnInstallCommand: RunInstallCommand = (command, args, options) =>
  new Promise((resolve) => {
    const detached = process.platform !== 'win32';
    let child: ChildProcess;
    try {
      child = spawn(command, [...args], {
        shell: false,
        detached,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: options.env,
      });
    } catch (error) {
      resolve({ kind: 'failed', exitCode: null, output: error instanceof Error ? error.message : String(error) });
      return;
    }
    let output = '';
    let settled = false;
    let outcome: 'cancelled' | 'timeout' | null = null;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const stop = (why: 'cancelled' | 'timeout'): void => {
      if (settled || outcome !== null) return;
      outcome = why;
      killGroup(child, 'SIGTERM', detached);
      grace = setTimeout(() => {
        killGroup(child, 'SIGKILL', detached);
      }, KILL_GRACE_MS);
    };
    const timer = setTimeout(() => {
      stop('timeout');
    }, options.timeoutMs);
    const onAbort = (): void => {
      stop('cancelled');
    };
    options.signal.addEventListener('abort', onAbort, { once: true });
    const feed = (chunk: Buffer): void => {
      const text = chunk.toString('utf8');
      output = appendBounded(output, text);
      const last = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .at(-1);
      if (last !== undefined) options.onLine(last.slice(0, 140));
    };
    child.stdout?.on('data', feed);
    child.stderr?.on('data', feed);
    const finish = (result: CommandRunOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (grace !== undefined) clearTimeout(grace);
      options.signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    child.once('error', (error) => {
      finish({ kind: 'failed', exitCode: null, output: error.message });
    });
    child.once('close', (code) => {
      if (outcome === 'cancelled') finish({ kind: 'cancelled', exitCode: code, output });
      else if (outcome === 'timeout') finish({ kind: 'timeout', exitCode: code, output });
      else if (code === 0) finish({ kind: 'ok', exitCode: 0, output });
      else finish({ kind: 'failed', exitCode: code, output });
    });
  });

function lastErrorLine(output: string): string | null {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const priority = [...lines].reverse().find((line) => /error|err!|failed|eacces|eperm|denied|not found|404/i.test(line));
  return (priority ?? lines.at(-1) ?? null)?.slice(0, 180) ?? null;
}

export interface ProviderInstallerContext {
  readonly platform: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly host: () => HostTarget | undefined;
  readonly rendererUrl: string;
  readonly clientOnly: () => boolean;
  readonly detectTools?: () => Promise<InstallTools>;
  readonly runCommand?: RunInstallCommand;
  readonly timeoutMs?: number;
  readonly onProgress: (progress: ProviderInstallProgress) => void;
}

export interface ProviderInstaller {
  capabilities(): Promise<ProviderInstallCapabilities>;
  install(request: InstallRequest): Promise<ProviderInstallResult>;
  cancel(providerId: string): void;
  stopAll(): void;
}

async function isBuiltinOnHost(providerId: string, host: HostTarget | undefined, rendererUrl: string): Promise<'ok' | 'not-builtin' | 'not-found'> {
  const reply = await proxyRequest({
    sender: { kind: 'frame', url: rendererUrl, isMainFrame: true },
    rendererUrl,
    input: { method: 'GET', path: '/api/plugins' },
    host,
  });
  const list = PluginListReply.safeParse(reply.body);
  const entry = list.success ? list.data.plugins.find(({ manifest }) => manifest.id === providerId) : undefined;
  if (entry?.manifest.kind !== 'provider') return 'not-found';
  return entry.source === 'built-in' ? 'ok' : 'not-builtin';
}

/** Runs strictly allowlisted built-in provider CLI installs/updates in main with progress, timeout and cancellation. */
export function createProviderInstaller(context: ProviderInstallerContext): ProviderInstaller {
  const running = new Map<string, AbortController>();
  const baseEnv = context.env ?? process.env;
  const detect = context.detectTools ?? (() => detectInstallTools(context.platform, baseEnv));
  const runCommand = context.runCommand ?? spawnInstallCommand;
  const timeoutMs = context.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    capabilities: async () => {
      if (context.clientOnly()) return {};
      return capabilitiesOf(context.platform, await detect());
    },
    install: async ({ providerId, mode }) => {
      if (context.clientOnly()) {
        return { kind: 'failed', reason: 'Engines run on the server you joined; its owner installs them there.', downloadUrl: null };
      }
      if (!isBuiltinProviderId(providerId)) {
        return { kind: 'failed', reason: 'Only built-in providers support 1-click install.', downloadUrl: null };
      }
      const checked = await isBuiltinOnHost(providerId, context.host(), context.rendererUrl);
      if (checked === 'not-found') return { kind: 'failed', reason: 'Ori Kami could not find this provider.', downloadUrl: null };
      if (checked === 'not-builtin') return { kind: 'failed', reason: 'Only built-in providers support 1-click install.', downloadUrl: null };
      if (running.has(providerId)) {
        return { kind: 'failed', reason: 'An install is already running for this provider.', downloadUrl: null };
      }
      const plan = planProviderInstall(providerId, mode, context.platform, await detect());
      switch (plan.kind) {
        case 'unsupported':
          return { kind: 'failed', reason: plan.reason, downloadUrl: plan.downloadUrl };
        case 'download':
          return { kind: 'failed', reason: plan.reason, downloadUrl: plan.url };
        case 'run':
          break;
      }
      const controller = new AbortController();
      running.set(providerId, controller);
      const verb = mode === 'update' ? 'Updating' : 'Installing';
      context.onProgress({ providerId, mode, phase: 'running', detail: `${verb} with ${plan.label}…` });
      try {
        const env: NodeJS.ProcessEnv = {
          ...baseEnv,
          PATH: installerSearchPath(context.platform, baseEnv),
          CI: '1',
          NONINTERACTIVE: '1',
          HOMEBREW_NO_AUTO_UPDATE: '1',
          HOMEBREW_NO_ENV_HINTS: '1',
          npm_config_yes: 'true',
        };
        const result = await runCommand(plan.command, plan.args, {
          env,
          signal: controller.signal,
          timeoutMs,
          onLine: (line) => {
            context.onProgress({ providerId, mode, phase: 'running', detail: line });
          },
        });
        switch (result.kind) {
          case 'ok':
            context.onProgress({ providerId, mode, phase: 'done', detail: 'Checking installed CLI…' });
            return { kind: 'installed' };
          case 'cancelled':
            context.onProgress({ providerId, mode, phase: 'cancelled', detail: 'Cancelled.' });
            return { kind: 'cancelled' };
          case 'timeout': {
            const reason = `${verb} timed out. Try downloading the CLI directly instead.`;
            context.onProgress({ providerId, mode, phase: 'failed', detail: reason });
            return { kind: 'failed', reason, downloadUrl: plan.downloadUrl };
          }
          case 'failed': {
            const detail = lastErrorLine(result.output);
            const code = result.exitCode === null ? '' : ` (exit ${String(result.exitCode)})`;
            const reason = detail === null ? `${verb} failed${code}.` : `${verb} failed${code}: ${detail}`;
            context.onProgress({ providerId, mode, phase: 'failed', detail: reason });
            return { kind: 'failed', reason, downloadUrl: plan.downloadUrl };
          }
        }
      } finally {
        running.delete(providerId);
      }
    },
    cancel: (providerId) => {
      running.get(providerId)?.abort();
    },
    stopAll: () => {
      for (const controller of running.values()) controller.abort();
      running.clear();
    },
  };
}
