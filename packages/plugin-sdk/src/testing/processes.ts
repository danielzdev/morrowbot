import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

/** `unsignalable` (EPERM): macOS reports it for a group whose members are exited but not yet reaped. */
export type Liveness = 'alive' | 'unsignalable' | 'gone';

/** Signal 0 checks a process (or, for a negative pid, a whole process group) without touching it. */
export function liveness(pid: number): Liveness {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return 'gone';
    if (error instanceof Error && 'code' in error && error.code === 'EPERM') return 'unsignalable';
    throw error;
  }
}

/** Polls until every pid is gone or `timeoutMs` passes, then reports each one by name. */
export async function waitUntilGone(
  pids: Readonly<Record<string, number>>,
  timeoutMs = 4_000,
): Promise<Record<string, Liveness>> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const report: Record<string, Liveness> = {};
    for (const [name, pid] of Object.entries(pids)) report[name] = liveness(pid);
    if (Object.values(report).every((state) => state === 'gone') || performance.now() > deadline) return report;
    await sleep(20);
  }
}

/** Waits until `file` holds a full line and returns it, trimmed. */
export async function readLineWhenWritten(file: string, timeoutMs = 5_000): Promise<string> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const text = await readFile(file, 'utf8').catch(() => '');
    if (text.includes('\n')) return text.trim();
    if (performance.now() > deadline) throw new Error(`${file} was not written within ${String(timeoutMs)} ms`);
    await sleep(10);
  }
}
