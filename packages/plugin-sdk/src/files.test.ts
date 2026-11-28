import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { listDirectory, readOptionalFile, statExecutable } from './files.ts';

let base: string;
beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'orikami-sdk-files-')));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

type Settled = { readonly kind: 'value'; readonly value: unknown } | { readonly kind: 'threw'; readonly message: string };

async function settle(promise: Promise<unknown>): Promise<Settled> {
  try {
    return { kind: 'value', value: redact(await promise) };
  } catch (error) {
    return { kind: 'threw', message: String(redact(error instanceof Error ? error.message : error)) };
  }
}

function redact(value: unknown): unknown {
  if (value === undefined) return value;
  const redacted: unknown = JSON.parse(JSON.stringify(value).replaceAll(base, '<base>'));
  return redacted;
}

it('reads a file, returns null when it is missing, and throws when it cannot be read or is too big', async () => {
  await writeFile(path.join(base, 'three.txt'), 'abc');
  await writeFile(path.join(base, 'empty.txt'), '');
  await mkdir(path.join(base, 'dir'));
  expect({
    fits: await settle(readOptionalFile(path.join(base, 'three.txt'), { maxBytes: 3 })),
    empty: await settle(readOptionalFile(path.join(base, 'empty.txt'), { maxBytes: 3 })),
    missing: await settle(readOptionalFile(path.join(base, 'missing.txt'), { maxBytes: 3 })),
    tooBig: await settle(readOptionalFile(path.join(base, 'three.txt'), { maxBytes: 2 })),
    directory: await settle(readOptionalFile(path.join(base, 'dir'), { maxBytes: 3 })),
  }).toMatchInlineSnapshot(`
    {
      "directory": {
        "kind": "threw",
        "message": "EISDIR: illegal operation on a directory, read",
      },
      "empty": {
        "kind": "value",
        "value": "",
      },
      "fits": {
        "kind": "value",
        "value": "abc",
      },
      "missing": {
        "kind": "value",
        "value": null,
      },
      "tooBig": {
        "kind": "threw",
        "message": "<base>/three.txt is larger than 2 bytes",
      },
    }
  `);
});

it('lists a directory sorted, returns null when it is missing, and throws for a file', async () => {
  const dir = path.join(base, 'dir');
  await mkdir(dir);
  for (const name of ['b', 'a', 'C', '.hidden']) await writeFile(path.join(dir, name), '');
  await writeFile(path.join(base, 'file'), '');
  expect({
    listed: await settle(listDirectory(dir)),
    missing: await settle(listDirectory(path.join(base, 'missing'))),
    file: await settle(listDirectory(path.join(base, 'file'))),
  }).toMatchInlineSnapshot(`
    {
      "file": {
        "kind": "threw",
        "message": "ENOTDIR: not a directory, scandir '<base>/file'",
      },
      "listed": {
        "kind": "value",
        "value": [
          ".hidden",
          "C",
          "a",
          "b",
        ],
      },
      "missing": {
        "kind": "value",
        "value": null,
      },
    }
  `);
});

it('finds executables by path or on PATH, skipping files that are not executable', async () => {
  const first = path.join(base, 'first');
  const second = path.join(base, 'second');
  await mkdir(first);
  await mkdir(second);
  await mkdir(path.join(first, 'tool-dir'));
  await writeFile(path.join(first, 'tool'), '#!/bin/sh\n');
  await writeFile(path.join(second, 'tool'), '#!/bin/sh\n');
  await chmod(path.join(second, 'tool'), 0o755);
  const found = (executable: Awaited<ReturnType<typeof statExecutable>>) =>
    redact(executable.kind === 'found' ? { kind: 'found', path: executable.path, size: executable.size } : executable);
  const onPath = ['', first, second].join(path.delimiter);
  expect({
    onPath: found(await statExecutable('tool', onPath)),
    byPath: found(await statExecutable(path.join(second, 'tool'), onPath)),
    notExecutable: found(await statExecutable(path.join(first, 'tool'), onPath)),
    directory: found(await statExecutable(path.join(first, 'tool-dir'), onPath)),
    missingOnPath: found(await statExecutable('no-such-tool', onPath)),
    missingPath: found(await statExecutable(path.join(base, 'no-such-tool'), onPath)),
  }).toMatchInlineSnapshot(`
    {
      "byPath": {
        "kind": "found",
        "path": "<base>/second/tool",
        "size": 10,
      },
      "directory": {
        "kind": "missing",
      },
      "missingOnPath": {
        "kind": "missing",
      },
      "missingPath": {
        "kind": "missing",
      },
      "notExecutable": {
        "kind": "missing",
      },
      "onPath": {
        "kind": "found",
        "path": "<base>/second/tool",
        "size": 10,
      },
    }
  `);
});
