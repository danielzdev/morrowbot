import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./features/plugins/fixtures', import.meta.url));

it('boots in safe mode with 0 plugins and stops cleanly on SIGTERM', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'morrowbot-main-'));
  try {
    const host = spawn(process.execPath, [MAIN, '--safe-mode'], {
      env: { PATH: process.env.PATH, MORROWBOT_HOST_PORT: '0', MORROWBOT_DATA_DIR: dataDir, MORROWBOT_PLUGINS_DIR: FIXTURES },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    host.stdout.on('data', (data: Buffer) => {
      output += data.toString();
      if (output.includes('listening on')) host.kill('SIGTERM');
    });
    host.stderr.on('data', (data: Buffer) => (output += data.toString()));
    const code = await new Promise<number | null>((resolve) => host.once('exit', resolve));
    expect({ code, output: output.replace(/:\d+\n/, ':PORT\n') }).toMatchInlineSnapshot(`
      {
        "code": 0,
        "output": "MorrowBot host: safe mode, 0 plugins loaded
      MorrowBot host 0.0.0 listening on http://127.0.0.1:PORT
      ",
      }
    `);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
