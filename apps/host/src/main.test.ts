import { fork, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HostLaunchMessage } from '@morrowbot/contracts';
import { expect, it } from 'vitest';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./features/plugins/fixtures', import.meta.url));

function hostEnv(dataDir: string): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, MORROWBOT_HOST_PORT: '0', MORROWBOT_DATA_DIR: dataDir, MORROWBOT_PLUGINS_DIR: FIXTURES };
}

async function withDataDir(body: (dataDir: string) => Promise<void>): Promise<void> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'morrowbot-main-'));
  try {
    await body(dataDir);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

/** Forks the host with a Node IPC channel, the way Electron main does. */
function forkHost(dataDir: string): { readonly child: ChildProcess; readonly output: () => string } {
  const child = fork(MAIN, ['--safe-mode'], {
    env: hostEnv(dataDir),
    execArgv: [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  child.stdout?.on('data', (data: Buffer) => (output += data.toString()));
  child.stderr?.on('data', (data: Buffer) => (output += data.toString()));
  return { child, output: () => output };
}

function firstMessage(child: ChildProcess): Promise<HostLaunchMessage> {
  return new Promise((resolve, reject) => {
    child.once('message', (message) => {
      resolve(HostLaunchMessage.parse(message));
    });
    child.once('exit', (code) => {
      reject(new Error(`host exited with ${String(code)} before its first message`));
    });
  });
}

function exitCode(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => child.once('exit', resolve));
}

it('boots in safe mode with 0 plugins and stops cleanly on SIGTERM', async () => {
  await withDataDir(async (dataDir) => {
    const host = spawn(process.execPath, [MAIN, '--safe-mode'], {
      env: hostEnv(dataDir),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let signalled = false;
    host.stdout.on('data', (data: Buffer) => {
      output += data.toString();
      if (!signalled && output.includes('listening on')) signalled = host.kill('SIGTERM');
    });
    host.stderr.on('data', (data: Buffer) => (output += data.toString()));
    const code = await new Promise<number | null>((resolve) => host.once('exit', resolve));
    expect({ code, output: output.replace(/:\d+\n/, ':PORT\n') }).toMatchInlineSnapshot(`
      {
        "code": 0,
        "output": "MorrowBot host: safe mode, 0 plugins loaded
      MorrowBot host 0.0.0 listening on http://127.0.0.1:PORT
      MorrowBot host: plugin provider-claude is stopped
      MorrowBot host: plugin provider-openai is stopped
      MorrowBot host: plugin provider-antigravity is stopped
      MorrowBot host: plugin echo is stopped
      MorrowBot host: plugin faulty is stopped
      ",
      }
    `);
  });
});

it('runs the built-in Claude, Codex and Antigravity providers with no plugins folder configured', async () => {
  await withDataDir(async (dataDir) => {
    const env = { PATH: process.env.PATH, HOME: dataDir, MORROWBOT_HOST_PORT: '0', MORROWBOT_DATA_DIR: path.join(dataDir, 'data') };
    const host = spawn(process.execPath, [MAIN], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let signalled = false;
    host.stdout.on('data', (data: Buffer) => {
      output += data.toString();
      if (!signalled && output.includes('listening on')) signalled = host.kill('SIGTERM');
    });
    host.stderr.on('data', (data: Buffer) => (output += data.toString()));
    const code = await new Promise<number | null>((resolve) => host.once('exit', resolve));
    const lines = output.split('\n').filter((line) => /running|listening/.test(line));
    expect({ code, lines: lines.map((line) => line.replace(/:\d+$/, ':PORT')).sort() }).toMatchInlineSnapshot(`
      {
        "code": 0,
        "lines": [
          "MorrowBot host 0.0.0 listening on http://127.0.0.1:PORT",
          "MorrowBot host: 3 plugin(s) running",
          "MorrowBot host: plugin provider-antigravity is running",
          "MorrowBot host: plugin provider-claude is running",
          "MorrowBot host: plugin provider-openai is running",
        ],
      }
    `);
  });
});

it('tells its parent the url and token, and the API accepts only that token', async () => {
  await withDataDir(async (dataDir) => {
    const { child, output } = forkHost(dataDir);
    try {
      const message = await firstMessage(child);
      if (message.kind !== 'ready') throw new Error(`expected ready, got ${message.kind}`);
      const agents = `${message.url}/api/agents`;
      const anonymous = await fetch(agents);
      const wrongToken = await fetch(agents, { headers: { authorization: `Bearer ${'x'.repeat(message.token.length)}` } });
      const authorized = await fetch(agents, { headers: { authorization: `Bearer ${message.token}` } });
      expect({
        url: message.url.replace(/:\d+$/, ':PORT'),
        tokenLongEnough: message.token.length >= 32,
        anonymous: anonymous.status,
        wrongToken: wrongToken.status,
        authorized: authorized.status,
        tokenPrinted: output().includes(message.token),
      }).toMatchInlineSnapshot(`
        {
          "anonymous": 401,
          "authorized": 200,
          "tokenLongEnough": true,
          "tokenPrinted": false,
          "url": "http://127.0.0.1:PORT",
          "wrongToken": 401,
        }
      `);
    } finally {
      child.disconnect();
      await exitCode(child);
    }
  });
});

it('a parent disconnect during startup cancels startup', async () => {
  await withDataDir(async (dataDir) => {
    const { child, output } = forkHost(dataDir);
    child.disconnect();
    const code = await exitCode(child);
    expect({ code, listened: output().includes('listening on') }).toMatchInlineSnapshot(`
      {
        "code": 0,
        "listened": false,
      }
    `);
  });
});

it('a second host process on the same data directory exits before opening the main DB', async () => {
  await withDataDir(async (dataDir) => {
    const first = forkHost(dataDir);
    try {
      const ready = await firstMessage(first.child);
      if (ready.kind !== 'ready') throw new Error(`expected ready, got ${ready.kind}`);
      const second = forkHost(dataDir);
      const message = await firstMessage(second.child);
      const code = await exitCode(second.child);
      const stillAnswers = await fetch(`${ready.url}/api/agents`, { headers: { authorization: `Bearer ${ready.token}` } });
      expect({
        message,
        code,
        output: second.output().replace(dataDir, '<dataDir>'),
        firstStatus: stillAnswers.status,
      }).toMatchInlineSnapshot(`
        {
          "code": 3,
          "firstStatus": 200,
          "message": {
            "kind": "already-running",
          },
          "output": "MorrowBot host: already running for <dataDir>
        ",
        }
      `);
    } finally {
      first.child.disconnect();
      await exitCode(first.child);
    }
  });
});
