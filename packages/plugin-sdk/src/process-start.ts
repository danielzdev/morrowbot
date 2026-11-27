import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * A process's OS start time, as text that is stable across locale, timezone and DST:
 * `TZ=UTC LC_ALL=C /bin/ps -ww -o lstart= -p <pid>` on macOS, `/proc/<pid>/stat` field 22 on Linux.
 * Undefined when it cannot be read. The host reads it the same way to recognise a reused pid.
 */
export function readProcessStart(pid: number): string | undefined {
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      return fields[19] || undefined;
    }
    const output = execFileSync('/bin/ps', ['-ww', '-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      env: { TZ: 'UTC', LC_ALL: 'C' },
      timeout: 2_000,
    });
    return output.trim() || undefined;
  } catch {
    return undefined;
  }
}
