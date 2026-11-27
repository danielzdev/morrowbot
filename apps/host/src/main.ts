import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { z } from 'zod';
import { pluginProviders } from './features/chat/index.ts';
import { parseHostConfig } from './features/config/index.ts';
import { startHost } from './host.ts';

const PackageJson = z.object({ version: z.string() });

const result = parseHostConfig({ env: process.env, args: process.argv.slice(2), homeDir: homedir() });
switch (result.kind) {
  case 'invalid':
    console.error(`MorrowBot host: invalid config\n${result.problems.join('\n')}`);
    process.exitCode = 1;
    break;
  case 'ok': {
    const { config } = result;
    const { version } = PackageJson.parse(
      JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')),
    );
    const host = await startHost({
      config,
      version,
      providers: pluginProviders,
      onPluginStatus: ({ pluginId, status }) => {
        console.log(`MorrowBot host: plugin ${pluginId} is ${status.kind}`);
      },
      newId: randomUUID,
      now: () => new Date().toISOString(),
      report: (error) => {
        console.error('MorrowBot host:', error);
      },
    });
    for (const problem of host.plugins.problems) console.error(`MorrowBot host: skipped plugin ${problem}`);
    const running = host.plugins.list().filter(({ status }) => status.kind === 'running').length;
    console.log(
      config.safeMode
        ? 'MorrowBot host: safe mode, 0 plugins loaded'
        : `MorrowBot host: ${String(running)} plugin(s) running`,
    );
    console.log(`MorrowBot host ${version} listening on ${host.url}`);
    let stopping = false;
    const stop = (): void => {
      if (stopping) return;
      stopping = true;
      void host.close().catch((error: unknown) => {
        console.error('MorrowBot host: failed to stop cleanly', error);
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    break;
  }
}
