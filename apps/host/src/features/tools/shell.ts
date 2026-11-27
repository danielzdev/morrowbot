import { spawn } from 'node:child_process';
import type { ToolResult } from '@morrowbot/contracts';

const MAX_OUTPUT_BYTES = 256 * 1024;
/** How long output may keep arriving after the command exits, from processes that left its process group. */
const DRAIN_AFTER_EXIT_MS = 250;

class CappedText {
  private readonly chunks: Buffer[] = [];
  private size = 0;
  truncated = false;

  push(chunk: Buffer): void {
    const room = MAX_OUTPUT_BYTES - this.size;
    if (chunk.length > room) this.truncated = true;
    if (room <= 0) return;
    const kept = chunk.subarray(0, room);
    this.chunks.push(kept);
    this.size += kept.length;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

/**
 * Runs `command` in a shell with `cwd` as its working folder. Abort kills the whole process group, and so does the
 * command exiting: background processes it left behind would otherwise hold the output pipes open forever.
 */
export function runShell(command: string, cwd: string, signal: AbortSignal | undefined): Promise<ToolResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ kind: 'aborted' });
      return;
    }
    const posix = process.platform !== 'win32';
    const child = spawn(command, { cwd, shell: true, detached: posix, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = new CappedText();
    const stderr = new CappedText();
    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
    });

    const killGroup = (): void => {
      if (posix && child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      } else {
        child.kill('SIGKILL');
      }
    };
    let aborted = false;
    const kill = (): void => {
      aborted = true;
      killGroup();
      child.stdout.destroy();
      child.stderr.destroy();
    };
    signal?.addEventListener('abort', kill, { once: true });
    let drain: NodeJS.Timeout | undefined;
    child.once('exit', () => {
      killGroup();
      drain = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
      }, DRAIN_AFTER_EXIT_MS);
    });

    const finish = (result: ToolResult): void => {
      clearTimeout(drain);
      signal?.removeEventListener('abort', kill);
      resolve(result);
    };
    child.once('error', (error) => {
      finish(aborted ? { kind: 'aborted' } : { kind: 'failed', error: error.message });
    });
    child.once('close', (exitCode, exitSignal) => {
      finish(
        aborted
          ? { kind: 'aborted' }
          : {
              kind: 'shell',
              exitCode,
              signal: exitSignal,
              stdout: stdout.text(),
              stderr: stderr.text(),
              truncated: stdout.truncated || stderr.truncated,
            },
      );
    });
  });
}
