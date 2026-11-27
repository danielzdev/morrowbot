import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ToolCall } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createWorkspaceTools } from './index.ts';

let base: string;
let workspace: string;
let outside: string;
beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-tools-')));
  workspace = path.join(base, 'workspace');
  outside = path.join(base, 'outside');
  await mkdir(workspace);
  await mkdir(outside);
  await writeFile(path.join(outside, 'secret.txt'), 'secret');
  await symlink(outside, path.join(workspace, 'escape'));
  await symlink(path.join(outside, 'missing.txt'), path.join(workspace, 'dangling'));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

function redact(value: unknown): unknown {
  const redacted: unknown = JSON.parse(JSON.stringify(value).replaceAll(base, '<base>'));
  return redacted;
}

it('keeps file reads and writes inside the workspace', async () => {
  const tools = createWorkspaceTools(workspace);
  const calls: ToolCall[] = [
    { kind: 'write_file', path: 'notes/today.md', content: 'hello' },
    { kind: 'read_file', path: 'notes/today.md' },
    { kind: 'read_file', path: path.join(workspace, 'notes/today.md') },
    { kind: 'read_file', path: '../outside/secret.txt' },
    { kind: 'read_file', path: path.join(outside, 'secret.txt') },
    { kind: 'read_file', path: 'escape/secret.txt' },
    { kind: 'write_file', path: 'escape/new.txt', content: 'x' },
    { kind: 'write_file', path: 'dangling', content: 'x' },
    { kind: 'read_file', path: 'notes/missing.md' },
  ];
  const results = [];
  for (const call of calls) results.push(await tools.run(call));
  expect(redact(results)).toMatchInlineSnapshot(`
    [
      {
        "bytes": 5,
        "kind": "write_file",
      },
      {
        "content": "hello",
        "kind": "read_file",
      },
      {
        "content": "hello",
        "kind": "read_file",
      },
      {
        "kind": "denied",
        "reason": "../outside/secret.txt is outside the agent workspace",
      },
      {
        "kind": "denied",
        "reason": "<base>/outside/secret.txt is outside the agent workspace",
      },
      {
        "kind": "denied",
        "reason": "escape/secret.txt is outside the agent workspace",
      },
      {
        "kind": "denied",
        "reason": "escape/new.txt is outside the agent workspace",
      },
      {
        "kind": "denied",
        "reason": "dangling is outside the agent workspace",
      },
      {
        "error": "ENOENT: no such file or directory, open '<base>/workspace/notes/missing.md'",
        "kind": "failed",
      },
    ]
  `);
  await expect(readFile(path.join(outside, 'missing.txt'), 'utf8')).rejects.toThrow('ENOENT');
});

it('runs shell commands in the workspace with structured output', async () => {
  const tools = createWorkspaceTools(workspace);
  const result = await tools.run({ kind: 'shell', command: 'pwd; echo oops >&2; exit 3' });
  expect(redact(result)).toMatchInlineSnapshot(`
    {
      "exitCode": 3,
      "kind": "shell",
      "signal": null,
      "stderr": "oops
    ",
      "stdout": "<base>/workspace
    ",
      "truncated": false,
    }
  `);
});

it('kills the whole process group when aborted', async () => {
  const tools = createWorkspaceTools(workspace);
  const controller = new AbortController();
  const started = performance.now();
  const running = tools.run({ kind: 'shell', command: 'sleep 30 & echo $! > child.pid; wait' }, controller.signal);
  const pidFile = path.join(workspace, 'child.pid');
  while ((await readFile(pidFile, 'utf8').catch(() => '')).trim() === '') {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  controller.abort();
  expect(await running).toEqual({ kind: 'aborted' });
  expect(performance.now() - started).toBeLessThan(5000);

  const pid = Number(await readFile(pidFile, 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(() => process.kill(pid, 0)).toThrow('ESRCH');
});

it('returns when the command exits, killing what it left running in the background', async () => {
  const tools = createWorkspaceTools(workspace);
  const started = performance.now();
  const result = await tools.run({ kind: 'shell', command: 'sleep 30 & echo $! > child.pid; echo done' });
  expect({ result, fast: performance.now() - started < 5000 }).toMatchInlineSnapshot(`
    {
      "fast": true,
      "result": {
        "exitCode": 0,
        "kind": "shell",
        "signal": null,
        "stderr": "",
        "stdout": "done
    ",
        "truncated": false,
      },
    }
  `);
  const pid = Number(await readFile(path.join(workspace, 'child.pid'), 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(() => process.kill(pid, 0)).toThrow('ESRCH');
});

it('accepts absolute paths through a symlinked workspace path', async () => {
  const linked = path.join(base, 'linked');
  await symlink(workspace, linked);
  const tools = createWorkspaceTools(linked);
  expect(
    redact([
      await tools.run({ kind: 'write_file', path: path.join(linked, 'a.txt'), content: 'via link' }),
      await tools.run({ kind: 'read_file', path: path.join(workspace, 'a.txt') }),
      await tools.run({ kind: 'read_file', path: path.join(linked, '..', 'outside', 'secret.txt') }),
    ]),
  ).toMatchInlineSnapshot(`
    [
      {
        "bytes": 8,
        "kind": "write_file",
      },
      {
        "content": "via link",
        "kind": "read_file",
      },
      {
        "kind": "denied",
        "reason": "<base>/outside/secret.txt is outside the agent workspace",
      },
    ]
  `);
});

it('refuses named pipes instead of blocking on them', async () => {
  execFileSync('mkfifo', [path.join(workspace, 'pipe')]);
  const tools = createWorkspaceTools(workspace);
  expect(
    redact([
      await tools.run({ kind: 'read_file', path: 'pipe' }),
      await tools.run({ kind: 'write_file', path: 'pipe', content: 'x' }),
    ]),
  ).toMatchInlineSnapshot(`
    [
      {
        "error": "pipe is not a regular file",
        "kind": "failed",
      },
      {
        "error": "ENXIO: no such device or address, open '<base>/workspace/pipe'",
        "kind": "failed",
      },
    ]
  `);
});
