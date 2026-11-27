import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';

/** What `kill(-pgid, 0)` says about a process group. */
export type GroupSignal = 'alive' | 'gone' | 'denied';

/** The process whose pid is the group id (the guard that led it), as far as it can be read. */
export type Leader =
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'process'; readonly start: string; readonly args: string };

/** How the host looks at processes. It only ever probes groups; it never signals one to stop. */
export interface ProcessProbe {
  signalGroup(pgid: number): GroupSignal;
  leader(pid: number): Promise<Leader>;
  bootId(): Promise<string | null>;
}

export interface GroupIdentity {
  readonly pgid: number;
  readonly leaderStart: string;
  readonly bootId: string | null;
}

/**
 * The one release predicate (boot recovery, live cleanup and every re-probe). A group is gone when
 * `kill(-pgid, 0)` reports ESRCH, when the boot ids differ (both read), or when the pid now belongs to
 * a different process (other start time, or not a command guard). EPERM, a live group without its
 * leader, and anything unreadable keep the group blocked.
 */
export async function isGroupGone(group: GroupIdentity, currentBootId: string | null, probe: ProcessProbe): Promise<boolean> {
  if (group.bootId !== null && currentBootId !== null && group.bootId !== currentBootId) return true;
  if (probe.signalGroup(group.pgid) === 'gone') return true;
  const leader = await probe.leader(group.pgid);
  switch (leader.kind) {
    case 'none':
    case 'unreadable':
      return false;
    case 'process':
      if (leader.start === '' || leader.args === '') return false;
      if (group.leaderStart !== 'unreadable' && leader.start !== group.leaderStart) return true;
      return !leader.args.includes('command-guard');
  }
}

const PS_TIMEOUT_MS = 2_000;

/** Reads processes the same way the SDK guard reads its own start time. */
export const systemProbe: ProcessProbe = {
  signalGroup: (pgid) => {
    try {
      process.kill(-pgid, 0);
      return 'alive';
    } catch (error) {
      return error instanceof Error && 'code' in error && error.code === 'ESRCH' ? 'gone' : 'denied';
    }
  },
  leader: async (pid) => (process.platform === 'linux' ? linuxLeader(pid) : psLeader(pid)),
  bootId: async () => {
    try {
      const text =
        process.platform === 'linux'
          ? await readFile('/proc/sys/kernel/random/boot_id', 'utf8')
          : await run('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid']).then((result) => (result.kind === 'ok' ? result.stdout : ''));
      return text.trim() || null;
    } catch {
      return null;
    }
  },
};

async function psLeader(pid: number): Promise<Leader> {
  const result = await run('/bin/ps', ['-ww', '-o', 'lstart=,args=', '-p', String(pid)]);
  switch (result.kind) {
    case 'failed':
      return { kind: 'unreadable' };
    case 'no-match':
      return { kind: 'none' };
    case 'ok': {
      const line = result.stdout.trim();
      if (line === '') return { kind: 'none' };
      return { kind: 'process', start: line.slice(0, 24).trim(), args: line.slice(24).trim() };
    }
  }
}

async function linuxLeader(pid: number): Promise<Leader> {
  try {
    const stat = await readFile(`/proc/${String(pid)}/stat`, 'utf8');
    const cmdline = await readFile(`/proc/${String(pid)}/cmdline`, 'utf8');
    const start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? '';
    return { kind: 'process', start, args: cmdline.split('\0').join(' ').trim() };
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT' ? { kind: 'none' } : { kind: 'unreadable' };
  }
}

type RunResult = { readonly kind: 'ok'; readonly stdout: string } | { readonly kind: 'no-match' } | { readonly kind: 'failed' };

function run(file: string, args: readonly string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(file, args, { env: { TZ: 'UTC', LC_ALL: 'C' }, timeout: PS_TIMEOUT_MS }, (error, stdout) => {
      if (error === null) resolve({ kind: 'ok', stdout });
      else if (error.code === 1 && stdout.trim() === '' && error.killed !== true) resolve({ kind: 'no-match' });
      else resolve({ kind: 'failed' });
    });
  });
}
