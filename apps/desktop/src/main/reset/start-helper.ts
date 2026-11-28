import { spawn, type ChildProcess } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { AgentList, lenient, WhoAmI } from '@morrowbot/contracts';
import { z } from 'zod';
import type { ServerMode } from '../../renderer/bridge.ts';
import { proxyRequest, type HostTarget } from '../ipc-proxy.ts';
import type { CleanupJob } from './cleanup-job.ts';
import type { HelperHandle } from './reset-flow.ts';
import { clearResetLock, writeResetLock } from './reset-lock.ts';

const READY_MS = 15_000;
const Ready = z.strictObject({ kind: z.literal('ready') });
const Committed = z.strictObject({ kind: z.literal('committed') });
const WhoAmIReply = lenient(WhoAmI);
const AgentListReply = lenient(AgentList);

/**
 * Starts the cleanup helper detached under Electron-as-Node, so it outlives main, sends it the job over IPC, and
 * waits until it has checked the job and loaded every module it needs: after that, moving Ori Bot.app to the
 * Trash cannot break it. The reset lock is written before this resolves; `release` sends `commit` and waits for
 * `committed`; `cancel` and any failed release kill the helper and remove the lock.
 */
export function startCleanupHelper(script: string, job: CleanupJob): Promise<HelperHandle> {
  const dataDir = job.context.profile.dataDir;
  const child = spawn(process.execPath, [script], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  const kill = (): void => {
    child.kill('SIGKILL');
    clearResetLock(dataDir);
  };
  let started = false;
  return new Promise((resolve, reject) => {
    const fail = (message: string): void => {
      if (started) return;
      started = true;
      clearTimeout(timer);
      kill();
      reject(new Error(message));
    };
    const timer = setTimeout(() => {
      fail('The cleanup helper did not start in time.');
    }, READY_MS);
    child.on('error', (error) => {
      fail(`The cleanup helper could not start: ${error.message}`);
    });
    child.once('exit', (code) => {
      fail(`The cleanup helper exited early (${String(code)}).`);
    });
    child.once('message', (message) => {
      if (!Ready.safeParse(message).success || child.pid === undefined) {
        fail('The cleanup helper sent an unexpected message.');
        return;
      }
      try {
        writeResetLock(dataDir, child.pid);
      } catch (error) {
        fail(`Ori Bot could not write its reset lock: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      started = true;
      clearTimeout(timer);
      child.removeAllListeners('exit');
      resolve({ release: () => commit(child, kill), cancel: kill });
    });
    child.send({ kind: 'job', job }, (error) => {
      if (error !== null) fail(`Ori Bot could not hand the job to the cleanup helper: ${error.message}`);
    });
  });
}

/** Sends `commit` and resolves once the helper confirms it; anything else kills the helper. */
function commit(child: ChildProcess, kill: () => void): Promise<void> {
  return new Promise((done, failed) => {
    let finished = false;
    const finish = (error: Error | null): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.removeAllListeners('exit');
      if (error !== null) {
        kill();
        failed(error);
        return;
      }
      if (child.connected) child.disconnect();
      child.unref();
      done();
    };
    const timer = setTimeout(() => {
      finish(new Error('The cleanup helper did not confirm in time.'));
    }, READY_MS);
    child.once('exit', () => {
      finish(new Error('The cleanup helper stopped before it could go ahead.'));
    });
    child.once('message', (message) => {
      finish(Committed.safeParse(message).success ? null : new Error('The cleanup helper sent an unexpected message.'));
    });
    if (!child.connected) {
      finish(new Error('The cleanup helper is no longer running.'));
      return;
    }
    child.send({ kind: 'commit' }, (error) => {
      if (error !== null) finish(error);
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
 * it could not be checked) has local agents nobody can list, so null. Otherwise there are no local agents, but a joined
 * server's agents may still work in folders on this Mac, so its list is needed too: null when it does not answer.
 */
export async function resetWorkspaces(mode: ServerMode, target: HostTarget | undefined, rendererUrl: string, dataDir: string): Promise<readonly string[] | null> {
  switch (mode.kind) {
    case 'local':
      return hostWorkspaces(target, rendererUrl);
    case 'remote':
    case 'choosing': {
      if ((await fileState(path.join(dataDir, 'oribot.sqlite'))) !== 'absent') return null;
      return mode.kind === 'remote' ? hostWorkspaces(target, rendererUrl) : [];
    }
  }
}

/**
 * Every agent's workspace folder, as given and with links resolved, or null when the host cannot list all of its
 * agents: it does not answer, or this app is a scoped member there, who sees only the agents shared with it.
 */
export async function hostWorkspaces(host: HostTarget | undefined, rendererUrl: string): Promise<readonly string[] | null> {
  if (host === undefined) return null;
  const get = (apiPath: string) => proxyRequest({ sender: { kind: 'frame', url: rendererUrl, isMainFrame: true }, rendererUrl, input: { method: 'GET', path: apiPath }, host });
  try {
    const me = await get('/api/me');
    const caller = WhoAmIReply.safeParse(me.body);
    if (me.status !== 200 || !caller.success || (caller.data.kind === 'member' && caller.data.access.kind === 'scoped')) return null;
    const reply = await get('/api/agents');
    const agents = AgentListReply.safeParse(reply.body);
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
