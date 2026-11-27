import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { parseHostConfig } from './features/config/index.ts';
import { startHealthServer } from './features/health/index.ts';

const PackageJson = z.object({ version: z.string() });

const result = parseHostConfig(process.env);
switch (result.kind) {
  case 'invalid':
    console.error(`MorrowBot host: invalid config\n${result.problems.join('\n')}`);
    process.exitCode = 1;
    break;
  case 'ok': {
    const { version } = PackageJson.parse(
      JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')),
    );
    const server = await startHealthServer(result.config, version);
    console.log(`MorrowBot host ${version} listening on ${server.url}`);
    let stopping = false;
    const stop = (): void => {
      if (stopping) return;
      stopping = true;
      void server.close().catch((error: unknown) => {
        console.error('MorrowBot host: failed to close server', error);
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    break;
  }
}
