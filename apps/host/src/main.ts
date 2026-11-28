import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { HostLaunchMessage } from '@morrowbot/contracts';
import { z } from 'zod';
import { parseHostConfig, type HostConfig } from './features/config/index.ts';
import { describeProblem } from './features/plugins/index.ts';
import { HostLockedError, startHost, type Host } from './host.ts';

const PackageJson = z.object({ version: z.string() });

/**
 * One owner for the process lifetime. A parent disconnect or a signal aborts startup if it is still running,
 * or closes the host once it has started. Registered before any await, so a parent that dies early never orphans us.
 */
const lifetime = new AbortController();
let host: Host | undefined;
function stop(): void {
  if (lifetime.signal.aborted) return;
  lifetime.abort();
  if (host !== undefined) closeHost(host);
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
if (process.channel !== undefined) process.once('disconnect', stop);

function closeHost(running: Host): void {
  running.close().catch((error: unknown) => {
    console.error('Ori Kami host: failed to stop cleanly', error);
    process.exitCode = 1;
  });
}

/** Tells the forking parent how startup went. A final message also closes the channel so the process can exit. */
function tellParent(message: HostLaunchMessage): void {
  if (!process.connected) return;
  const final = message.kind !== 'ready';
  process.send?.(message, () => {
    if (final && process.connected) process.disconnect?.();
  });
}

async function run(config: HostConfig): Promise<void> {
  const { version } = PackageJson.parse(
    JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')),
  );
  let started: Host;
  try {
    started = await startHost({
      config,
      version,
      onPluginStatus: ({ pluginId, status }) => {
        console.log(`Ori Kami host: plugin ${pluginId} is ${status.kind}`);
      },
      newId: randomUUID,
      now: () => new Date().toISOString(),
      report: (error) => {
        console.error('Ori Kami host:', error);
      },
      signal: lifetime.signal,
    });
  } catch (error) {
    if (lifetime.signal.aborted) return;
    process.exitCode = startupFailed(error, config);
    return;
  }
  if (lifetime.signal.aborted) {
    closeHost(started);
    return;
  }
  host = started;
  for (const problem of started.plugins.problems()) console.error(`Ori Kami host: skipped plugin ${describeProblem(problem)}`);
  const running = started.plugins.list().filter(({ status }) => status.kind === 'running').length;
  console.log(
    config.safeMode
      ? `Ori Kami host: safe mode, only the ${String(running)} built-in provider(s) running`
      : `Ori Kami host: ${String(running)} plugin(s) running`,
  );
  console.log(`Ori Kami host ${version} listening on ${started.url}`);
  tellParent({ kind: 'ready', url: started.url, token: started.token });
}

/** Reports a startup failure to the console and the parent, and returns the exit code. */
function startupFailed(error: unknown, config: HostConfig): number {
  if (error instanceof HostLockedError) {
    console.error(`Ori Kami host: already running for ${config.dataDir}`);
    tellParent({ kind: 'already-running' });
    return 3;
  }
  console.error('Ori Kami host: failed to start', error);
  tellParent({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
  return 1;
}

const result = parseHostConfig({ env: process.env, args: process.argv.slice(2), homeDir: homedir() });
switch (result.kind) {
  case 'invalid':
    console.error(`Ori Kami host: invalid config\n${result.problems.join('\n')}`);
    tellParent({ kind: 'failed', message: 'invalid config' });
    process.exitCode = 1;
    break;
  case 'ok':
    await run(result.config);
    break;
}
