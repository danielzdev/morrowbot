import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { z } from 'zod';
import { parseHostConfig } from './features/config/index.ts';
import { startHost } from './host.ts';

const PackageJson = z.object({ version: z.string() });

const result = parseHostConfig(process.env, homedir());
switch (result.kind) {
  case 'invalid':
    console.error(`MorrowBot host: invalid config\n${result.problems.join('\n')}`);
    process.exitCode = 1;
    break;
  case 'ok': {
    const { version } = PackageJson.parse(
      JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')),
    );
    const host = await startHost({
      config: result.config,
      version,
      providers: { provider: () => undefined },
      catalog: { list: () => [] },
      newId: randomUUID,
      now: () => new Date().toISOString(),
      report: (error) => {
        console.error('MorrowBot host:', error);
      },
    });
    console.log(`MorrowBot host ${version} listening on ${host.url}`);
    let stopping = false;
    const stop = (): void => {
      if (stopping) return;
      stopping = true;
      void host.close().catch((error: unknown) => {
        console.error('MorrowBot host: failed to close', error);
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    break;
  }
}
