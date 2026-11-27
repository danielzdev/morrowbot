import { constants } from 'node:fs';
import { mkdir, open, realpath, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { AgentTools, ToolCall, ToolResult } from '@morrowbot/contracts';
import { confine } from './confine.ts';
import { runShell } from './shell.ts';

const MAX_READ_BYTES = 1024 * 1024;

/** Opening a pipe or device must not block, so an abort can always finish the call. */
const NONBLOCK = constants.O_NONBLOCK;

/**
 * File tools that cannot reach outside `workspaceDir` and touch only regular files, and a shell that starts in it.
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
      return withRegularFile(target.path, constants.O_RDONLY | NONBLOCK, call.path, async (file, size) => {
        if (size > MAX_READ_BYTES) return { kind: 'failed', error: `File is larger than ${String(MAX_READ_BYTES)} bytes` };
        const content = await file.readFile(signal === undefined ? 'utf8' : { encoding: 'utf8', signal });
        return { kind: 'read_file', content };
      });
    }
    case 'write_file': {
      const target = await confine(root, call.path);
      if (target.kind === 'outside') return denied(call.path);
      await mkdir(path.dirname(target.path), { recursive: true });
      const flags = constants.O_WRONLY | constants.O_CREAT | NONBLOCK;
      return withRegularFile(target.path, flags, call.path, async (file) => {
        await file.truncate(0);
        await file.writeFile(call.content, signal === undefined ? 'utf8' : { encoding: 'utf8', signal });
        return { kind: 'write_file', bytes: Buffer.byteLength(call.content) };
      });
    }
  }
}

async function withRegularFile(
  file: string,
  flags: number,
  requested: string,
  use: (handle: FileHandle, size: number) => Promise<ToolResult>,
): Promise<ToolResult> {
  const handle = await open(file, flags, 0o666);
  try {
    const info = await handle.stat();
    if (!info.isFile()) return { kind: 'failed', error: `${requested} is not a regular file` };
    return await use(handle, info.size);
  } finally {
    await handle.close();
  }
}

function denied(requested: string): ToolResult {
  return { kind: 'denied', reason: `${requested} is outside the agent workspace` };
}
