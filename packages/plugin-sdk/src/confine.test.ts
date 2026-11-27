import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { confinePath } from './confine.ts';

let base: string;
beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-sdk-confine-')));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

function redact(value: unknown): unknown {
  const redacted: unknown = JSON.parse(JSON.stringify(value).replaceAll(base, '<base>'));
  return redacted;
}

it('confines paths to the workspace, through symlinks and missing parents', async () => {
  const workspace = path.join(base, 'workspace');
  const outside = path.join(base, 'outside');
  await mkdir(path.join(workspace, 'notes'), { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(outside, 'secret.txt'), 'secret');
  await symlink(outside, path.join(workspace, 'escape'));
  await symlink(path.join(outside, 'missing.txt'), path.join(workspace, 'dangling'));
  await symlink(path.join(workspace, 'notes'), path.join(workspace, 'inner-link'));
  const requests = [
    'notes/today.md',
    path.join(workspace, 'notes/today.md'),
    'notes/new/deeper/file.md',
    '.',
    '../outside/secret.txt',
    path.join(outside, 'secret.txt'),
    'escape/secret.txt',
    'escape/new.txt',
    'dangling',
    'inner-link/x.md',
    'notes/../../outside',
  ];
  const results: Record<string, unknown> = {};
  for (const requested of requests) results[String(redact(requested))] = redact(await confinePath(workspace, requested));
  expect(results).toMatchInlineSnapshot(`
    {
      ".": {
        "kind": "inside",
        "path": "<base>/workspace",
      },
      "../outside/secret.txt": {
        "kind": "outside",
      },
      "<base>/outside/secret.txt": {
        "kind": "outside",
      },
      "<base>/workspace/notes/today.md": {
        "kind": "inside",
        "path": "<base>/workspace/notes/today.md",
      },
      "dangling": {
        "kind": "outside",
      },
      "escape/new.txt": {
        "kind": "outside",
      },
      "escape/secret.txt": {
        "kind": "outside",
      },
      "inner-link/x.md": {
        "kind": "inside",
        "path": "<base>/workspace/notes/x.md",
      },
      "notes/../../outside": {
        "kind": "outside",
      },
      "notes/new/deeper/file.md": {
        "kind": "inside",
        "path": "<base>/workspace/notes/new/deeper/file.md",
      },
      "notes/today.md": {
        "kind": "inside",
        "path": "<base>/workspace/notes/today.md",
      },
    }
  `);
});

it('confines paths under a workspace given through a symlink', async () => {
  const workspace = path.join(base, 'workspace');
  const linked = path.join(base, 'linked');
  await mkdir(workspace);
  await mkdir(path.join(base, 'outside'));
  await symlink(workspace, linked);
  const results: Record<string, unknown> = {};
  for (const requested of [path.join(linked, 'a.txt'), path.join(workspace, 'a.txt'), path.join(linked, '..', 'outside', 'x')]) {
    results[String(redact(requested))] = redact(await confinePath(linked, requested));
  }
  expect(results).toMatchInlineSnapshot(`
    {
      "<base>/linked/a.txt": {
        "kind": "inside",
        "path": "<base>/workspace/a.txt",
      },
      "<base>/outside/x": {
        "kind": "outside",
      },
      "<base>/workspace/a.txt": {
        "kind": "inside",
        "path": "<base>/workspace/a.txt",
      },
    }
  `);
});
