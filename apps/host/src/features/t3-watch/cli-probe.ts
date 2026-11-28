import { execFile } from 'node:child_process';
import { classifyFailure, parseList, parseShow, type ListResult, type ProbeResult } from './observation.ts';
import type { T3Probe } from './ports.ts';

/** Each `t3` call starts the T3 Code desktop binary, so one that hangs is cut off rather than holding a read slot. */
const CALL_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

type Ran = { readonly kind: 'ok'; readonly stdout: string } | { readonly kind: 'failed'; readonly stderr: string; readonly detail: string };

function run(bin: string, args: readonly string[]): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: CALL_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ kind: 'ok', stdout });
        return;
      }
      const detail = error.killed ? `t3 took longer than ${String(CALL_TIMEOUT_MS / 1000)} s` : error.message;
      resolve({ kind: 'failed', stderr, detail });
    });
  });
}

/** The v1 probe: the `t3` CLI, read-only (`thread show` and `thread list`, never `--wait`). */
export function cliProbe(bin: string): T3Probe {
  return {
    inspect: async (threadId): Promise<ProbeResult> => {
      const ran = await run(bin, ['thread', 'show', '--messages', '2', '--json', threadId]);
      if (ran.kind === 'ok') return parseShow(ran.stdout);
      const failure = classifyFailure(ran.stderr);
      return failure.kind === 'not_found' ? failure : { kind: failure.kind, detail: ran.stderr.trim() === '' ? ran.detail : failure.detail };
    },
    list: async (project): Promise<ListResult> => {
      const ran = await run(bin, ['thread', 'list', '--project', project, '--json']);
      if (ran.kind === 'ok') return parseList(ran.stdout);
      const failure = classifyFailure(ran.stderr);
      switch (failure.kind) {
        case 'not_found':
          return { kind: 'unreachable', detail: 'T3 Code could not find that project.' };
        case 'unreachable':
        case 'schema_mismatch':
          return { kind: failure.kind, detail: ran.stderr.trim() === '' ? ran.detail : failure.detail };
      }
    },
  };
}
