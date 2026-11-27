import { spawn } from 'node:child_process';
import type { ToolResult } from '@morrowbot/contracts';

const MAX_OUTPUT_BYTES = 256 * 1024;

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

/** Runs `command` in a shell with `cwd` as its working folder. Abort kills the whole process group. */
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

    let aborted = false;
    const kill = (): void => {
      aborted = true;
      if (posix && child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      } else {
        child.kill('SIGKILL');
      }
      child.stdout.destroy();
      child.stderr.destroy();
    };
    signal?.addEventListener('abort', kill, { once: true });

    const finish = (result: ToolResult): void => {
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
