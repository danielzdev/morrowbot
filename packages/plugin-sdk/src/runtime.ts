import { createCommandRunner, type CommandExit, type CommandOptions, type CommandRunner, type OpenCommand, type RunCommandOptions } from './command.ts';
import { OPEN, type Fence } from './fence.ts';
import { statExecutable, type Executable } from './files.ts';
import { createGroupLink, type GroupLink } from './host-link.ts';
import { jsonRpcProcessOver, type StartJsonRpcProcess } from './json-rpc-process.ts';
import { serveLoopback, type LoopbackServer, type LoopbackServerOptions } from './loopback.ts';
import type { PluginDefinition } from './plugin.ts';
import { readCliVersion, type CliVersion } from './version.ts';

export type RuntimeEnv = Readonly<Record<string, string | undefined>>;

/**
 * What a plugin runs programs and reads its environment through. Each plugin gets its own, so
 * several plugins can share one process (built-in providers run inside the host).
 */
export interface PluginRuntime {
  /** The environment the plugin's programs get: `PATH` plus the manifest's `envPreset`. Read `HOME` and the like here, never from `process.env`. */
  readonly env: RuntimeEnv;
  /** The OS the plugin runs on. Gate each per-OS access profile on it. */
  readonly platform: NodeJS.Platform;
  /**
   * Starts a program (found on this runtime's `PATH` unless given as a path) through a guard that
   * leads its own process group and has the host record the group before the program starts.
   */
  readonly openCommand: (command: string, options: CommandOptions) => OpenCommand;
  /** Runs a program to completion with `input` on stdin: the one-shot form of `openCommand`. */
  readonly runCommand: (command: string, options: RunCommandOptions) => Promise<CommandExit>;
  /** Starts a shared JSON-RPC daemon through `openCommand` (scope `daemon`). */
  readonly jsonRpcProcess: StartJsonRpcProcess;
  /** Finds an executable: `command` itself when it contains a path separator, otherwise the first match on this runtime's `PATH`. */
  readonly statExecutable: (command: string) => Promise<Executable>;
  /** Runs `<command> --version` (a probe) and returns its MAJOR.MINOR.PATCH, cached by the executable's path, mtime and size. */
  readonly readCliVersion: (command: string, options: { readonly cwd: string }) => Promise<CliVersion>;
  /** Listens for authenticated WebSocket clients on 127.0.0.1 (a browser extension, say). Close it in `shutdown`. */
  readonly serveLoopback: (options: LoopbackServerOptions) => Promise<LoopbackServer>;
}

/** What a plugin's entry hands to `runPlugin` (or a built-in provider to the host): it builds the plugin on its runtime. */
export type PluginFactory = (runtime: PluginRuntime) => PluginDefinition;

export interface RuntimeOptions {
  readonly env: RuntimeEnv;
  readonly platform: NodeJS.Platform;
  /** What every program the plugin starts runs behind. */
  readonly fence: Fence;
}

/** A runtime and the commands behind it, for the code that serves the plugin. */
export interface OwnedRuntime {
  readonly runtime: PluginRuntime;
  readonly commands: CommandRunner;
}

export function createRuntime(options: RuntimeOptions, link: GroupLink): OwnedRuntime {
  const commands = createCommandRunner(link, options.env, options.fence);
  const stat = (command: string): Promise<Executable> => statExecutable(command, options.env.PATH ?? '');
  const versions = { stat, run: commands.run, cache: new Map<string, string>() };
  const runtime: PluginRuntime = {
    env: options.env,
    platform: options.platform,
    openCommand: (command, commandOptions) => commands.open(command, commandOptions),
    runCommand: (command, commandOptions) => commands.run(command, commandOptions),
    jsonRpcProcess: jsonRpcProcessOver((command, commandOptions) => commands.open(command, commandOptions)),
    statExecutable: stat,
    readCliVersion: (command, versionOptions) => readCliVersion(versions, command, versionOptions),
    serveLoopback,
  };
  return { runtime, commands };
}

/**
 * A runtime with no host, for scripts and tests that run a plugin's pieces directly: every process
 * group is acknowledged at once. Defaults to this process's environment and OS.
 */
export function standaloneRuntime(options: Partial<RuntimeOptions> = {}): PluginRuntime {
  return createRuntime({ env: options.env ?? process.env, platform: options.platform ?? process.platform, fence: options.fence ?? OPEN }, createGroupLink()).runtime;
}
