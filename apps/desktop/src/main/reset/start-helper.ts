import { spawn } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { AgentList } from '@morrowbot/contracts';
import { z } from 'zod';
import type { ServerMode } from '../../renderer/bridge.ts';
import { proxyRequest, type HostTarget } from '../ipc-proxy.ts';
import type { CleanupJob } from './cleanup-job.ts';
import type { HelperHandle } from './reset-flow.ts';
import { writeResetLock } from './reset-lock.ts';

const READY_MS = 15_000;

/**
 * Starts the cleanup helper detached under Electron-as-Node, so it outlives main, and waits until it
 * has loaded every module it needs: after that, moving MorrowBot.app to the Trash cannot break it.
 * It acts only once `release` has written the reset lock and sent `commit`.
 */
export function startCleanupHelper(script: string, job: CleanupJob): Promise<HelperHandle> {
  const child = spawn(process.execPath, [script, JSON.stringify(job)], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  return new Promise((resolve, reject) => {
    const fail = (message: string): void => {
      clearTimeout(timer);
      child.kill('SIGKILL');
      reject(new Error(message));
    };
    const timer = setTimeout(() => {
      fail('The cleanup helper did not start in time.');
    }, READY_MS);
    child.once('error', (error) => {
      fail(`The cleanup helper could not start: ${error.message}`);
    });
    child.once('exit', (code) => {
      fail(`The cleanup helper exited early (${String(code)}).`);
    });
    child.once('message', (message) => {
      if (!z.strictObject({ kind: z.literal('ready') }).safeParse(message).success) {
        fail('The cleanup helper sent an unexpected message.');
        return;
      }
      clearTimeout(timer);
      child.removeAllListeners('exit');
      resolve({
        release: () =>
          new Promise<void>((done, failed) => {
            if (child.pid === undefined || !child.connected) {
              failed(new Error('The cleanup helper is no longer running.'));
              return;
            }
            writeResetLock(job.context.profile.dataDir, child.pid);
            child.send({ kind: 'commit' }, (error) => {
              if (error !== null) {
                failed(error);
                return;
              }
              child.disconnect();
              child.unref();
              done();
            });
          }),
        cancel: () => {
          child.kill('SIGKILL');
        },
      });
    });
  });
}

/** Whether a path is there; `unknown` when `lstat` failed for any reason but its absence. */
async function fileState(target: string): Promise<'present' | 'absent' | 'unknown'> {
  try {
    await lstat(target);
    return 'present';
  } catch (error) {
    return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR') ? 'absent' : 'unknown';
  }
}

/**
 * The agent workspaces a reset must never touch, or null when they cannot be known. With its own host, the host's
 * agents. Without one (joined a server, or still choosing), a data folder that still holds a local database (or may:
 * it could not be checked) has local agents nobody can list, so null; otherwise there are no local agents, and the joined server's list, when it gives
 * one, is kept too.
 */
export async function resetWorkspaces(mode: ServerMode, target: HostTarget | undefined, rendererUrl: string, dataDir: string): Promise<readonly string[] | null> {
  switch (mode.kind) {
    case 'local':
      return hostWorkspaces(target, rendererUrl);
    case 'remote':
    case 'choosing': {
      if ((await fileState(path.join(dataDir, 'morrowbot.sqlite'))) !== 'absent') return null;
      return mode.kind === 'remote' ? ((await hostWorkspaces(target, rendererUrl)) ?? []) : [];
    }
  }
}

/** Every agent's workspace folder, as given and with links resolved, or null when the host cannot list its agents. */
async function hostWorkspaces(host: HostTarget | undefined, rendererUrl: string): Promise<readonly string[] | null> {
  if (host === undefined) return null;
  try {
    const reply = await proxyRequest({
      sender: { kind: 'frame', url: rendererUrl, isMainFrame: true },
      rendererUrl,
      input: { method: 'GET', path: '/api/agents' },
      host,
    });
    const agents = AgentList.safeParse(reply.body);
    if (reply.status !== 200 || !agents.success) return null;
    const given = agents.data.agents.map(({ workspace }) => workspace.dir);
    if (!given.every((dir) => path.isAbsolute(dir))) return null;
    const dirs = given.map((dir) => path.normalize(dir));
    const real = await Promise.all(dirs.map((dir) => realpath(dir).catch(() => dir)));
    return [...new Set([...dirs, ...real])].sort();
  } catch {
    return null;
  }
}
