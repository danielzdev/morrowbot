import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentTools, ToolCall, ToolResult } from '@morrowbot/contracts';
import { confine } from './confine.ts';
import { runShell } from './shell.ts';

const MAX_READ_BYTES = 1024 * 1024;

/**
 * File tools that cannot reach outside `workspaceDir`, and a shell that starts in it.
 * The shell is not sandboxed: a command can still `cd` elsewhere.
 */
export function createWorkspaceTools(workspaceDir: string): AgentTools {
  return {
    run: async (call, signal) => {
      if (signal?.aborted) return { kind: 'aborted' };
      try {
        return await runTool(workspaceDir, call, signal);
      } catch (error) {
        if (signal?.aborted) return { kind: 'aborted' };
        return { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

async function runTool(root: string, call: ToolCall, signal: AbortSignal | undefined): Promise<ToolResult> {
  switch (call.kind) {
    case 'shell':
      return runShell(call.command, await realpath(root), signal);
    case 'read_file': {
      const target = await confine(root, call.path);
      if (target.kind === 'outside') return denied(call.path);
      const info = await stat(target.path);
      if (info.size > MAX_READ_BYTES) return { kind: 'failed', error: `File is larger than ${String(MAX_READ_BYTES)} bytes` };
      const content = await readFile(target.path, signal === undefined ? 'utf8' : { encoding: 'utf8', signal });
      return { kind: 'read_file', content };
    }
    case 'write_file': {
      const target = await confine(root, call.path);
      if (target.kind === 'outside') return denied(call.path);
      await mkdir(path.dirname(target.path), { recursive: true });
      await writeFile(target.path, call.content, signal === undefined ? 'utf8' : { encoding: 'utf8', signal });
      return { kind: 'write_file', bytes: Buffer.byteLength(call.content) };
    }
  }
}

function denied(requested: string): ToolResult {
  return { kind: 'denied', reason: `${requested} is outside the agent workspace` };
}
