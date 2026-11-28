import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { AgentList } from '@morrowbot/contracts';
import { z } from 'zod';
import { proxyRequest, type HostTarget } from '../ipc-proxy.ts';
import type { CleanupJob } from './cleanup-job.ts';
import type { HelperHandle } from './reset-flow.ts';

const READY_MS = 15_000;

/**
 * Starts the cleanup helper detached under Electron-as-Node, so it outlives main, and waits until it
 * has loaded every module it needs: after that, moving MorrowBot.app to the Trash cannot break it.
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
        release: () => {
          if (child.connected) child.disconnect();
          child.unref();
        },
        cancel: () => {
          child.kill('SIGKILL');
        },
      });
    });
  });
}

/** Every agent's workspace folder, as given and with links resolved, or null when the host cannot list its agents. */
export async function hostWorkspaces(host: HostTarget | undefined, rendererUrl: string): Promise<readonly string[] | null> {
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
    const dirs = agents.data.agents.map(({ workspace }) => workspace.dir);
    if (!dirs.every((dir) => path.isAbsolute(dir))) return null;
    const real = await Promise.all(dirs.map((dir) => realpath(dir).catch(() => dir)));
    return [...new Set([...dirs, ...real])].sort();
  } catch {
    return null;
  }
}
