import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { parseHostConfig } from './features/config/index.ts';
import { startHealthServer } from './features/health/index.ts';
import { createJsonPluginStore, startPluginHost } from './features/plugins/index.ts';

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
    const plugins = await startPluginHost({
      pluginsDir: config.pluginsDir,
      safeMode: config.safeMode,
      store: createJsonPluginStore(path.join(config.dataDir, 'plugins.json')),
    });
    for (const problem of plugins.problems) console.error(`MorrowBot host: skipped plugin ${problem}`);
    plugins.onStatus(({ pluginId, status }) => {
      console.log(`MorrowBot host: plugin ${pluginId} is ${status.kind}`);
    });
    const running = plugins.list().filter(({ status }) => status.kind === 'running').length;
    console.log(
      config.safeMode
        ? 'MorrowBot host: safe mode, 0 plugins loaded'
        : `MorrowBot host: ${String(running)} plugin(s) running`,
    );
    const server = await startHealthServer(config, version);
    console.log(`MorrowBot host ${version} listening on ${server.url}`);
    let stopping = false;
    const stop = (): void => {
      if (stopping) return;
      stopping = true;
      void Promise.all([plugins.stop(), server.close()]).catch((error: unknown) => {
        console.error('MorrowBot host: failed to stop cleanly', error);
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    break;
  }
}
